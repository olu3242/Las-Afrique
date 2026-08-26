import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  createMigratedDatabase,
  dropDatabase,
  migrationFiles,
} from "@/supabase/test/harness";
import { REFERENCE_TABLES, TENANT_TABLES } from "@/lib/supabase/types";

const DB = "tmh_test_schema";

describe("migrations", () => {
  let db: Client;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  it("applies every migration cleanly against a fresh database", async () => {
    // Reaching beforeAll without throwing is the assertion; this pins the
    // expected file set so a migration cannot be added without being noticed.
    expect(migrationFiles()).toEqual([
      "0001_initial_schema.sql",
      "0002_row_level_security.sql",
      "0003_revoke_anon_tenant_grants.sql",
    ]);
  });

  it("creates every table the type definitions declare", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const actual = rows.map((r) => r.table_name);
    const expected = [...TENANT_TABLES, ...REFERENCE_TABLES].sort();
    expect(actual.sort()).toEqual(expected);
  });

  it("gives every tenant table a user-owned column", async () => {
    for (const table of TENANT_TABLES) {
      // profiles is keyed by the user id itself; the rest carry user_id.
      const column = table === "profiles" ? "id" : "user_id";
      const { rows } = await db.query(
        `select 1 from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [table, column],
      );
      expect(rows, `${table}.${column} should exist`).toHaveLength(1);
    }
  });

  it("enables and forces row-level security on every tenant table", async () => {
    const { rows } = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((r) => [r.relname, r]));

    for (const table of TENANT_TABLES) {
      expect(byName.get(table)?.relrowsecurity, `${table} RLS enabled`).toBe(true);
      expect(byName.get(table)?.relforcerowsecurity, `${table} RLS forced`).toBe(
        true,
      );
    }
  });

  it("enables row-level security on reference tables too", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'country_profiles'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it("covers all four verbs with a policy on every tenant table", async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies where schemaname = 'public'`,
    );

    for (const table of TENANT_TABLES) {
      const verbs = rows
        .filter((r) => r.tablename === table)
        .map((r) => r.cmd)
        .sort();
      expect(verbs, `${table} policy verbs`).toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE",
      ]);
    }
  });

  it("leaves reference data with no write policy", async () => {
    const { rows } = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'country_profiles'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("strips anon grants a hosted project's default privileges would add", async () => {
    // A hosted Supabase project sets ALTER DEFAULT PRIVILEGES so new public
    // tables are granted to anon and authenticated automatically. A bare cluster
    // does not, so the first real hosted run was the first time anon held SELECT
    // on every tenant table. Reproducing that here keeps 0003 honest.
    const name = "tmh_test_hosted_defaults";
    const withDefaults = await createMigratedDatabase(
      name,
      "alter default privileges in schema public grant all on tables to anon, authenticated;",
    );

    try {
      const { rows } = await withDefaults.query<{
        table_name: string;
        privilege_type: string;
      }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = 'anon' and table_schema = 'public'`,
      );

      // anon keeps exactly one privilege: reading public reference data.
      const tenantGrants = rows.filter((r) =>
        (TENANT_TABLES as readonly string[]).includes(r.table_name),
      );
      expect(tenantGrants, "anon must hold no grant on any tenant table").toEqual(
        [],
      );

      const referenceGrants = rows
        .filter((r) => r.table_name === "country_profiles")
        .map((r) => r.privilege_type)
        .sort();
      expect(referenceGrants).toEqual(["SELECT"]);
    } finally {
      await withDefaults.end();
      await dropDatabase(name);
    }
  });

  it("is reproducible — a second fresh database yields the same schema", async () => {
    const second = "tmh_test_schema_repeat";
    const other = await createMigratedDatabase(second);
    try {
      const shape = `select table_name, column_name, data_type
                     from information_schema.columns
                     where table_schema = 'public'
                     order by table_name, column_name`;
      const a = await db.query(shape);
      const b = await other.query(shape);
      expect(b.rows).toEqual(a.rows);
    } finally {
      await other.end();
      await dropDatabase(second);
    }
  });
});

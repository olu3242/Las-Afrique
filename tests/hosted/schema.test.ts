import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, repoMigrationVersions } from "./connection";
import { REFERENCE_TABLES, TENANT_TABLES } from "@/lib/supabase/types";

/**
 * Proves the hosted project's actual state — not that a migration command
 * reported success.
 *
 * A `db push` that exits 0 is a claim. These assertions are the evidence.
 */
describe("hosted schema", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  it("has applied every migration the repository declares", async () => {
    const { rows } = await db.query<{ version: string }>(
      `select version from supabase_migrations.schema_migrations order by version`,
    );
    const hosted = rows.map((r) => r.version);
    const repo = repoMigrationVersions();

    // Every repo migration must be present. The hosted list may legitimately
    // carry extra entries the CLI created, so this is containment, not equality.
    for (const version of repo) {
      expect(hosted, `migration ${version} should be applied`).toContain(version);
    }
    expect(repo.length).toBeGreaterThan(0);
  });

  it("contains exactly the tables the type definitions declare", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const actual = rows.map((r) => r.table_name).sort();
    const expected = [...TENANT_TABLES, ...REFERENCE_TABLES].sort();
    expect(actual).toEqual(expected);
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
      expect(byName.get(table)?.relforcerowsecurity, `${table} RLS forced`).toBe(true);
    }
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

  it("leaves country reference data readable but not writable", async () => {
    const { rows } = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'country_profiles'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("withholds any tenant-table grant from anonymous callers", async () => {
    // Denial should land at the grant layer, before RLS is consulted.
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    const granted = rows.map((r) => r.table_name);
    for (const table of TENANT_TABLES) {
      expect(granted, `anon should hold no grant on ${table}`).not.toContain(table);
    }
  });
});

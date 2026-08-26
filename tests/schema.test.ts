import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  createMigratedDatabase,
  dropDatabase,
  migrationFiles,
} from "@/supabase/test/harness";
import { REFERENCE_TABLES, TENANT_TABLES } from "@/lib/supabase/types";
import {
  expectProfileTrigger,
  expectTenantConsistentTripKeys,
} from "./support/schema-queries";

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
      "0004_provision_profile_on_signup.sql",
      "0005_seed_country_identity.sql",
      "0006_tenant_consistent_foreign_keys.sql",
    ]);
  });

  it("seeds the launch countries with identity and no requirement claims", async () => {
    const { rows } = await db.query<{
      key: string;
      name: string;
      currency: string;
      verification_state: string;
      visa_entry_info: unknown;
      passport_considerations: unknown;
      source_url: string | null;
      last_verified_at: string | null;
    }>(
      `select key, name, currency, verification_state, visa_entry_info,
              passport_considerations, source_url, last_verified_at
       from public.country_profiles order by sort_order`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows[0].key).toBe("nigeria");
    expect(rows.every((r) => /^[A-Z]{3}$/.test(r.currency))).toBe(true);

    // The load-bearing half. Seeding a country's *identity* is fact; seeding
    // what it requires of a traveller would be fabrication, and this asserts
    // the migration did not quietly do that to make a card look finished.
    for (const row of rows) {
      expect(row.verification_state, row.key).toBe("unverified");
      expect(row.visa_entry_info, row.key).toBeNull();
      expect(row.passport_considerations, row.key).toBeNull();
      expect(row.source_url, row.key).toBeNull();
      expect(row.last_verified_at, row.key).toBeNull();
    }
  });

  it("re-runs the country seed without duplicating or clobbering verified data", async () => {
    // Migrations are append-only, but the seed is also the shape Iteration 3
    // will re-run. Applying it twice must not double the rows, and must not
    // overwrite requirement columns a later verified load has filled in.
    await db.query(
      `update public.country_profiles
       set visa_entry_info = '{"summary": "verified later"}'::jsonb,
           verification_state = 'verified'
       where key = 'ghana'`,
    );

    const seed = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0005_seed_country_identity.sql"),
      "utf8",
    );
    await db.query(seed);

    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from public.country_profiles where key = 'ghana'`,
    );
    expect(rows[0].count).toBe("1");

    const ghana = await db.query<{
      visa_entry_info: { summary: string } | null;
      verification_state: string;
    }>(
      `select visa_entry_info, verification_state
       from public.country_profiles where key = 'ghana'`,
    );
    expect(ghana.rows[0].visa_entry_info?.summary).toBe("verified later");
    expect(ghana.rows[0].verification_state).toBe("verified");
  });

  it("provisions a profile when an auth user is created", async () => {
    const { rows } = await db.query<{ id: string; display_name: string | null }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('provisioned@example.test', '{"display_name": "Ama"}'::jsonb)
       returning id`,
    );
    const profile = await db.query(
      `select display_name from public.profiles where id = $1`,
      [rows[0].id],
    );
    expect(profile.rowCount).toBe(1);
    expect(profile.rows[0].display_name).toBe("Ama");
  });

  it("provisions a profile even with no display name supplied", async () => {
    // The admin API and OAuth callbacks both create users with no metadata.
    // A profile that only appears when the sign-up form was used is not a
    // profile step, so this asserts the null case explicitly.
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('bare@example.test') returning id`,
    );
    const profile = await db.query(
      `select display_name from public.profiles where id = $1`,
      [rows[0].id],
    );
    expect(profile.rowCount).toBe(1);
    expect(profile.rows[0].display_name).toBeNull();
  });

  it("treats a blank display name as absent rather than storing it", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('blank@example.test', '{"display_name": "   "}'::jsonb)
       returning id`,
    );
    const profile = await db.query(
      `select display_name from public.profiles where id = $1`,
      [rows[0].id],
    );
    expect(profile.rows[0].display_name).toBeNull();
  });

  it("installs the profile trigger as a pinned security-definer function", async () => {
    // Same assertion the hosted suite runs, against the same real Postgres.
    // Sharing it is the point: the hosted-only version of this check was
    // broken and nothing local could have told me.
    await expectProfileTrigger(db);
  });

  it("ties every trip child row to the trip's owner", async () => {
    await expectTenantConsistentTripKeys(db);
  });

  it("removes the profile when the auth user is deleted", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('transient@example.test')
       returning id`,
    );
    await db.query(`delete from auth.users where id = $1`, [rows[0].id]);
    const profile = await db.query(
      `select 1 from public.profiles where id = $1`,
      [rows[0].id],
    );
    expect(profile.rowCount).toBe(0);
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

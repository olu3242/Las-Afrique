import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, repoMigrationVersions, sslConfig } from "./connection";
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
    const url = databaseUrl();
    db = new Client({ connectionString: url, ssl: sslConfig(url) });
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

  it("provisions a profile from the auth trigger", async () => {
    // 0004 installs a trigger on auth.users. Its presence on the hosted
    // project is what makes the profile step of the Iteration 2 path real —
    // a local test cannot show that it survived the push.
    const { rows } = await db.query<{ tgname: string; tgenabled: string }>(
      `select tgname, tgenabled from pg_trigger
       where tgrelid = 'auth.users'::regclass and not tgisinternal`,
    );
    const trigger = rows.find((r) => r.tgname === "on_auth_user_created");
    expect(trigger, "on_auth_user_created should exist on auth.users").toBeDefined();
    // 'D' means disabled. A trigger that exists but does not fire is worse
    // than one that is missing, because it looks present.
    expect(trigger?.tgenabled).not.toBe("D");
  });

  it("pins the profile trigger function to an empty search_path", async () => {
    // It is security definer, so an unpinned search_path would let a schema
    // the caller controls decide what `profiles` resolves to.
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc
       where proname = 'handle_new_user'
         and pronamespace = 'public'::regnamespace`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig ?? []).toContain("search_path=");
  });

  it("carries the launch countries with no fabricated requirements", async () => {
    const { rows } = await db.query<{
      key: string;
      verification_state: string;
      visa_entry_info: unknown;
      source_url: string | null;
    }>(
      `select key, verification_state, visa_entry_info, source_url
       from public.country_profiles order by sort_order`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.map((r) => r.key)).toContain("nigeria");

    // The rule that matters on a live project: a country may be listed, but
    // nothing may claim what it requires of a traveller until a real source
    // backs it. Anything verified here arrived from Iteration 3, not 0005 —
    // so only the unverified rows are held to the no-claims standard.
    for (const row of rows.filter((r) => r.verification_state === "unverified")) {
      expect(row.visa_entry_info, row.key).toBeNull();
      expect(row.source_url, row.key).toBeNull();
    }
  });

  it("ties every trip child row to the trip's owner", async () => {
    // 0006. A composite foreign key onto trips (id, user_id) is what stops one
    // user attaching rows to another user's trip — the insert policy alone
    // does not, which is how the defect was found.
    const { rows } = await db.query<{ table_name: string; columns: string[] }>(
      `select c.conrelid::regclass::text as table_name,
              array_agg(a.attname order by a.attnum) as columns
       from pg_constraint c
       join unnest(c.conkey) as k(attnum) on true
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       where c.contype = 'f'
         and c.confrelid = 'public.trips'::regclass
       group by c.oid, c.conrelid`,
    );

    const referencing = ["travelers", "document_records", "cost_estimates",
                         "savings_plans", "vault_files"];
    for (const table of referencing) {
      const constraint = rows.find((r) => r.table_name === `public.${table}`);
      expect(constraint, `${table} should reference trips`).toBeDefined();
      expect(constraint?.columns, `${table} must key on user_id too`).toContain(
        "user_id",
      );
    }
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

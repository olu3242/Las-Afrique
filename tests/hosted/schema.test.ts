import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, repoMigrationVersions, sslConfig } from "./connection";
import {
  GROUP_ROOT_TABLE,
  GROUP_TABLES,
  REFERENCE_TABLES,
  REFERRAL_DUAL_PARTY_TABLES,
  REFERRAL_REFERENCE_TABLES,
  REFERRAL_TENANT_TABLES,
  TENANT_TABLES,
} from "@/lib/supabase/types";
import {
  expectProfileTrigger,
  expectCountryProvenanceConstraints,
  expectDualPartyReferralPolicies,
  expectGroupHelperFunctions,
  expectGroupTableInvariants,
  expectNoCustodyColumns,
  expectNoRewardCustodyColumns,
  expectOneProgramInForce,
  expectReferralGrants,
  expectReferralHelperFunctions,
  expectTenantConsistentTripKeys,
} from "../support/schema-queries";

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
    const expected = [
      ...TENANT_TABLES,
      ...REFERENCE_TABLES,
      ...GROUP_TABLES,
      ...REFERRAL_DUAL_PARTY_TABLES,
      GROUP_ROOT_TABLE,
    ].sort();
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

  // --- group coordination (Iteration 11) ---------------------------------
  //
  // The same shared helpers the local tier runs. There they prove migration
  // 0011 is correct; here they prove the project actually has it. Adding the
  // group tables to the local suite alone is what turned hosted run 29 red —
  // exactly the drift these shared helpers exist to stop, so the fix is to use
  // them rather than to restate the queries.

  it("scopes every group table by membership, with all four verbs covered", async () => {
    await expectGroupTableInvariants(db, GROUP_TABLES);
  });

  it("makes the membership helpers security definer with a pinned search_path", async () => {
    await expectGroupHelperFunctions(db);
  });

  it("keeps custody of money out of the group schema", async () => {
    await expectNoCustodyColumns(db, [...GROUP_TABLES, GROUP_ROOT_TABLE]);
  });

  it("leaves the owner-scoped tables untouched by group policies", async () => {
    const { rows } = await db.query<{ tablename: string; qual: string | null }>(
      `select tablename, qual from pg_policies
        where schemaname = 'public'
          and tablename in ('trips', 'travelers', 'document_records',
                            'cost_estimates', 'savings_plans', 'vault_files')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.qual ?? "",
        `${row.tablename} policy must not consult group membership`,
      ).not.toMatch(/is_group_member|can_coordinate|group_/i);
    }
  });

  // --- referral (Iteration 12) -------------------------------------------
  //
  // The same shared helpers again, for the reason hosted run 29 established:
  // adding an assertion to the local tier and not this one is the drift these
  // helpers exist to prevent, and the local tier can be green while the
  // project has none of it.

  it("makes referrals readable by both parties and writable by neither", async () => {
    await expectDualPartyReferralPolicies(db);
  });

  it("makes the referral definer functions pinned, and normalise_email immutable", async () => {
    await expectReferralHelperFunctions(db);
  });

  it("has exactly one referral programme in force", async () => {
    await expectOneProgramInForce(db);
  });

  it("keeps custody of money out of the referral schema", async () => {
    await expectNoRewardCustodyColumns(db, [
      ...REFERRAL_TENANT_TABLES,
      ...REFERRAL_DUAL_PARTY_TABLES,
      ...REFERRAL_REFERENCE_TABLES,
    ]);
  });

  it("leaves the owner-scoped tables untouched by referral policies", async () => {
    const { rows } = await db.query<{ tablename: string; qual: string | null }>(
      `select tablename, qual from pg_policies
        where schemaname = 'public'
          and tablename in ('trips', 'travelers', 'document_records',
                            'cost_estimates', 'savings_plans', 'vault_files')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.qual ?? "",
        `${row.tablename} policy must not consult a referral`,
      ).not.toMatch(/referr|reward_/i);
    }
  });

  it("grants each referral table exactly what it needs, and nothing more", async () => {
    // The same helper the local tier runs against a database built with a
    // hosted project's default privileges. Here it runs against the project
    // itself, which is the only place the surplus those defaults add could
    // actually have survived — and did, until migration 0013.
    await expectReferralGrants(db);
  });

  it("leaves country reference data readable but not writable", async () => {
    const { rows } = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'country_profiles'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("provisions a profile from the auth trigger", async () => {
    // 0004. Asserted with the shared helper so the identical check runs
    // locally too — these queries were hosted-only once, and both were wrong.
    await expectProfileTrigger(db);
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

  it("carries the country provenance constraints", async () => {
    // 0007. A constraint only protects the project it was pushed to.
    await expectCountryProvenanceConstraints(db);
  });

  it("ties every trip child row to the trip's owner", async () => {
    // 0006.
    await expectTenantConsistentTripKeys(db);
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

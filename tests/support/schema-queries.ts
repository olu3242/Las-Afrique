import { expect } from "vitest";
import type { Client } from "pg";

/**
 * Schema assertions shared by the local and hosted suites.
 *
 * They live here because of a specific mistake: two of these were written as
 * hosted-only assertions, so nothing could exercise the *queries* until a
 * hosted run did, and both were wrong in ways a local run would have caught
 * in seconds:
 *
 *   - `proconfig` holds `search_path=""`, not `search_path=`, so an exact
 *     array match failed.
 *   - `conrelid::regclass::text` renders a bare `travelers` when `public` is
 *     in the search_path, not `public.travelers`, so the lookup found nothing.
 *
 * Neither was a schema defect. Both cost a hosted cycle to learn something a
 * throwaway local query answers immediately. Running the same assertion
 * against both databases is what stops that repeating — and it is also the
 * stronger test, because a divergence between local and hosted now shows up
 * as a failure rather than as an assertion nobody ran.
 */

/** Tables whose rows must belong to the same user as the trip they reference. */
export const TRIP_CHILD_TABLES = [
  "travelers",
  "document_records",
  "cost_estimates",
  "savings_plans",
  "vault_files",
] as const;

/**
 * The profile trigger must exist, fire, and be a security-definer function
 * pinned to an empty search_path.
 */
export async function expectProfileTrigger(db: Client): Promise<void> {
  const { rows: triggers } = await db.query<{
    tgname: string;
    tgenabled: string;
  }>(
    `select tgname, tgenabled from pg_trigger
     where tgrelid = 'auth.users'::regclass and not tgisinternal`,
  );

  const trigger = triggers.find((t) => t.tgname === "on_auth_user_created");
  expect(trigger, "on_auth_user_created should exist on auth.users").toBeDefined();
  // 'D' is disabled. A trigger that exists but never fires is worse than a
  // missing one, because it looks present.
  expect(trigger?.tgenabled).not.toBe("D");

  const { rows: fn } = await db.query<{
    prosecdef: boolean;
    proconfig: string[] | null;
  }>(
    `select prosecdef, proconfig from pg_proc
     where proname = 'handle_new_user'
       and pronamespace = 'public'::regnamespace`,
  );

  expect(fn).toHaveLength(1);
  expect(fn[0].prosecdef, "handle_new_user must be security definer").toBe(true);

  // Postgres stores the empty setting as `search_path=""`. Matched by shape
  // rather than by an exact string, so either spelling passes and a *non*-empty
  // search_path still fails — which is the property that matters: a security
  // definer function with an unpinned search_path lets the caller decide what
  // `profiles` resolves to.
  const searchPath = (fn[0].proconfig ?? []).find((entry) =>
    entry.startsWith("search_path="),
  );
  expect(searchPath, "handle_new_user must pin search_path").toBeDefined();
  expect(
    searchPath?.replace(/^search_path=/, "").replace(/"/g, ""),
    "search_path must be empty",
  ).toBe("");
}

/**
 * Every table referencing a trip must key on (trip_id, user_id), so a child's
 * owner is forced to equal its parent's.
 */
export async function expectTenantConsistentTripKeys(db: Client): Promise<void> {
  // Joined through pg_class/pg_namespace rather than cast via regclass: the
  // regclass text form omits the schema when it is on the search_path, so the
  // rendered name differs between a local cluster and the hosted project.
  const { rows } = await db.query<{ table_name: string; columns: string[] }>(
    `select cl.relname as table_name,
            array_agg(a.attname order by a.attnum) as columns
     from pg_constraint c
     join pg_class cl on cl.oid = c.conrelid
     join pg_namespace n on n.oid = cl.relnamespace
     join unnest(c.conkey) as k(attnum) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid = 'public.trips'::regclass
       and n.nspname = 'public'
     group by c.oid, cl.relname`,
  );

  for (const table of TRIP_CHILD_TABLES) {
    const constraint = rows.find((r) => r.table_name === table);
    expect(constraint, `${table} should reference trips`).toBeDefined();
    expect(
      constraint?.columns,
      `${table} must key on user_id as well as trip_id`,
    ).toContain("user_id");
    expect(constraint?.columns, `${table} must key on trip_id`).toContain(
      "trip_id",
    );
  }
}

/**
 * A country claim cannot be stored without provenance.
 *
 * Run against both databases for the same reason the others are: a constraint
 * that exists in a migration but was never pushed is a constraint that is not
 * protecting anything, and only the hosted assertion can tell the difference.
 */
export async function expectCountryProvenanceConstraints(
  db: Client,
): Promise<void> {
  const { rows } = await db.query<{ conname: string }>(
    `select conname from pg_constraint
     where conrelid = 'public.country_profiles'::regclass and contype = 'c'`,
  );
  const names = rows.map((r) => r.conname);

  for (const expected of [
    "country_profiles_claims_need_provenance",
    "country_profiles_verified_needs_provenance",
    "country_profiles_source_url_is_http",
    "country_profiles_verified_at_not_future",
  ]) {
    expect(names, `${expected} should exist`).toContain(expected);
  }
}

/**
 * The vault bucket and its policies.
 *
 * Shared for the same reason as everything else here, and for one more: the
 * local tier proves migration 0009 is correct, and only the hosted tier proves
 * it was ever applied to the project the app actually talks to. Those are
 * different claims, and running one assertion against both is what keeps them
 * from being confused for each other — which is precisely the confusion that
 * let Iteration 8 read PASS on evidence that never touched storage.
 */
export async function expectVaultBucket(db: Client): Promise<void> {
  const { rows } = await db.query<{
    public: boolean;
    file_size_limit: string;
    allowed_mime_types: string[];
  }>(
    `select public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'vault'`,
  );

  expect(rows, "migration 0009 did not create the vault bucket").toHaveLength(1);
  // Public would make a passport scan reachable by URL alone.
  expect(rows[0].public).toBe(false);
  expect(Number(rows[0].file_size_limit)).toBe(15_728_640);
  expect(rows[0].allowed_mime_types).toContain("application/pdf");
  expect(rows[0].allowed_mime_types).toContain("image/jpeg");
  // No archives, no executables, nothing that is not a travel document.
  expect(rows[0].allowed_mime_types).not.toContain("application/zip");
}

/** Every verb on storage.objects must be covered by a vault policy. */
export async function expectVaultStoragePolicies(db: Client): Promise<void> {
  const { rows } = await db.query<{ cmd: string }>(
    `select cmd from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'vault_%'`,
  );

  const verbs = new Set(rows.map((r) => r.cmd.toUpperCase()));
  for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    expect(verbs, `no vault storage policy for ${verb}`).toContain(verb);
  }
}

/**
 * Group coordination tables (Iteration 11).
 *
 * These are asserted separately from TENANT_TABLES because their access model
 * genuinely differs: read is membership-scoped, write is role-scoped, so a
 * table legitimately carries more than one policy per verb. The tenant
 * assertion demands exactly four policies and would have had to be weakened to
 * accommodate them — weakening a certified assertion to fit new code is how a
 * boundary quietly stops being one.
 */
export async function expectGroupTableInvariants(
  db: Client,
  tables: readonly string[],
): Promise<void> {
  const { rows: security } = await db.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `select relname, relrowsecurity, relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`,
  );
  const byName = new Map(security.map((r) => [r.relname, r]));

  const { rows: policies } = await db.query<{ tablename: string; cmd: string }>(
    `select tablename, cmd from pg_policies where schemaname = 'public'`,
  );

  for (const table of tables) {
    expect(byName.get(table)?.relrowsecurity, `${table} RLS enabled`).toBe(true);
    expect(byName.get(table)?.relforcerowsecurity, `${table} RLS forced`).toBe(true);

    const verbs = new Set(
      policies.filter((r) => r.tablename === table).map((r) => r.cmd),
    );
    for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(verbs, `${table} needs a ${verb} policy`).toContain(verb);
    }

    // group_id is the scoping key every group policy predicates on. A table
    // without it cannot be membership-scoped, whatever its policies say.
    const { rows } = await db.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = $1
          and column_name = 'group_id'`,
      [table],
    );
    expect(rows, `${table}.group_id should exist`).toHaveLength(1);
  }
}

/**
 * The membership helpers must be security definer with a pinned search_path.
 *
 * Definer is what breaks the recursion in a membership policy that has to read
 * memberships. An empty search_path is what stops a schema earlier on the
 * caller's path from substituting a different table underneath one.
 */
export async function expectGroupHelperFunctions(db: Client): Promise<void> {
  const { rows } = await db.query<{
    proname: string;
    prosecdef: boolean;
    proconfig: string[] | null;
  }>(
    `select proname, prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('is_group_member', 'can_coordinate', 'group_role_of',
                        'guard_membership_shared_columns')`,
  );

  for (const name of [
    "is_group_member",
    "can_coordinate",
    "group_role_of",
    "guard_membership_shared_columns",
  ]) {
    const fn = rows.find((r) => r.proname === name);
    expect(fn, `${name} should exist`).toBeDefined();
    expect(fn?.prosecdef, `${name} must be security definer`).toBe(true);
    expect(fn?.proconfig ?? [], `${name} must pin search_path`).toContain(
      'search_path=""',
    );
  }
}

/**
 * No group table may carry a column that implies custody of money.
 *
 * Iteration 11 is coordination only — an estimate and who books it. This is
 * asserted rather than trusted to review, because the drift it guards against
 * arrives one innocuous column at a time.
 */
export async function expectNoCustodyColumns(
  db: Client,
  tables: readonly string[],
): Promise<void> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1)`,
    [[...tables]],
  );

  const forbidden = /balance|escrow|wallet|payout|settle|transfer|ledger|held_/i;
  const offenders = rows.filter((r) => forbidden.test(r.column_name));
  expect(
    offenders.map((r) => `${r.table_name}.${r.column_name}`),
    "group tables must not imply custody of funds",
  ).toEqual([]);
}

/**
 * The referral engine's non-custodial invariant (Iteration 12).
 *
 * PRD §8: the product does not hold money. A reward entitlement records that
 * something was *earned under a named policy*, never that Take Me Home owes
 * anybody anything, and the difference between those two is one column.
 *
 * `owed` is in the pattern here and was absent from the group version, because
 * this is the engine where somebody would plausibly add it.
 */
export async function expectNoRewardCustodyColumns(
  db: Client,
  tables: readonly string[],
): Promise<void> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1)`,
    [[...tables]],
  );

  const forbidden =
    /balance|escrow|wallet|payout|settle|transfer|ledger|owed|held_|amount|currency/i;
  const offenders = rows.filter((r) => forbidden.test(r.column_name));
  expect(
    offenders.map((r) => `${r.table_name}.${r.column_name}`),
    "referral tables must not imply custody of funds",
  ).toEqual([]);
}

/**
 * `referrals` is readable by both parties and writable by neither.
 *
 * The write refusal is stated as explicit `false` policies rather than left to
 * absent ones. Both refuse, but only one of them is visible in the schema, and
 * an absent policy is indistinguishable from a policy somebody forgot.
 */
export async function expectDualPartyReferralPolicies(db: Client): Promise<void> {
  const { rows } = await db.query<{
    policyname: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `select policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'referrals'`,
  );

  const verbs = new Set(rows.map((r) => r.cmd));
  for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    expect(verbs, `referrals needs a ${verb} policy`).toContain(verb);
  }

  const select = rows.find((r) => r.cmd === "SELECT");
  expect(select?.qual ?? "", "referrals must be readable by both parties")
    .toMatch(/referrer_id/);
  expect(select?.qual ?? "").toMatch(/referred_user_id/);

  for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
    const policy = rows.find((r) => r.cmd === cmd);
    const predicate = `${policy?.qual ?? ""}${policy?.with_check ?? ""}`;
    expect(
      predicate,
      `referrals ${cmd} must be refused outright — writes go through the definer functions`,
    ).toMatch(/false/);
  }
}

/**
 * The referral definer functions must be security definer with a pinned
 * search_path — the same two properties the group helpers need, for the same
 * two reasons: definer is what lets them write rows the caller may not, and an
 * empty search_path is what stops a schema earlier on the caller's path from
 * substituting a different table underneath one.
 */
export async function expectReferralHelperFunctions(db: Client): Promise<void> {
  const { rows } = await db.query<{
    proname: string;
    prosecdef: boolean;
    proconfig: string[] | null;
  }>(
    `select proname, prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('attribute_referral', 'evaluate_referral_qualification',
                        'guard_referral_invitation_rate',
                        'guard_referral_immutability', 'normalise_email')`,
  );

  for (const name of [
    "attribute_referral",
    "evaluate_referral_qualification",
    "guard_referral_invitation_rate",
    "guard_referral_immutability",
  ]) {
    const fn = rows.find((r) => r.proname === name);
    expect(fn, `${name} should exist`).toBeDefined();
    expect(fn?.prosecdef, `${name} must be security definer`).toBe(true);
    expect(fn?.proconfig ?? [], `${name} must pin search_path`).toContain(
      'search_path=""',
    );
  }

  // normalise_email is not definer — it reads nothing. It must be immutable,
  // because a unique index and a generated column both depend on it.
  const normalise = rows.find((r) => r.proname === "normalise_email");
  expect(normalise, "normalise_email should exist").toBeDefined();
  const { rows: volatility } = await db.query<{ provolatile: string }>(
    `select provolatile from pg_proc
      where proname = 'normalise_email' and pronamespace = 'public'::regnamespace`,
  );
  expect(volatility[0]?.provolatile, "normalise_email must be immutable").toBe("i");
}

/**
 * Exactly one referral programme may be in force.
 *
 * Without this, "the current programme" becomes a judgement about which of
 * several overlapping rows applies, and an entitlement earned under one could
 * be read back against another.
 */
export async function expectOneProgramInForce(db: Client): Promise<void> {
  const { rows } = await db.query<{ indexdef: string }>(
    `select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'referral_programs'
        and indexname = 'referral_programs_one_in_force'`,
  );
  expect(rows, "referral_programs_one_in_force should exist").toHaveLength(1);
  expect(rows[0].indexdef).toMatch(/UNIQUE/i);
  expect(rows[0].indexdef).toMatch(/effective_to IS NULL/i);

  const { rows: inForce } = await db.query<{ count: string }>(
    `select count(*) as count from public.referral_programs
      where effective_to is null`,
  );
  expect(inForce[0].count).toBe("1");
}

/**
 * Exactly what each referral table grants, and to whom.
 *
 * Shared because of the defect it exists to catch. Migration 0012 revoked
 * `anon` and then *added* the grants `authenticated` needs — but adding a
 * grant does not remove one, and a hosted project's ALTER DEFAULT PRIVILEGES
 * had already granted ALL on every new table. So `authenticated` kept INSERT,
 * UPDATE and DELETE on `referrals` and `reward_entitlements`, which no client
 * may write, and on `referral_programs`, which is reference data.
 *
 * A bare local cluster has no default privileges, so the local tier could not
 * see it: the surplus simply was not there to find. The local caller therefore
 * runs this against a database built *with* those defaults, and the hosted
 * caller runs it against the real project. Same assertion, both tiers — the
 * arrangement that stops the next table repeating this.
 *
 * TRUNCATE is called out in the expectations because row-level security does
 * not apply to it at all. It is the one verb no policy can contain, so a
 * surplus grant of it is the one that matters most.
 */
export async function expectReferralGrants(db: Client): Promise<void> {
  const READ_ONLY = [
    "referrals",
    "reward_entitlements",
    "referral_programs",
    // Attempts are written only by claim_referral_invitation_attempt. A rate
    // limit whose rows a caller can delete is not a rate limit.
    "referral_invitation_attempts",
  ];
  const OWNER_WRITTEN = ["referral_codes", "referral_invitations"];

  const { rows } = await db.query<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }>(
    `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and table_name = any($1)`,
    [[...READ_ONLY, ...OWNER_WRITTEN]],
  );

  const held = (table: string, grantee: string) =>
    rows
      .filter((r) => r.table_name === table && r.grantee === grantee)
      .map((r) => r.privilege_type)
      .sort();

  // anon holds nothing anywhere. The link route reads no database at all, so
  // there is no reason for a single grant to exist.
  for (const table of [...READ_ONLY, ...OWNER_WRITTEN]) {
    expect(held(table, "anon"), `anon on ${table}`).toEqual([]);
  }

  // Read-only to every client: the two writes go through definer functions.
  for (const table of READ_ONLY) {
    expect(held(table, "authenticated"), `authenticated on ${table}`).toEqual([
      "SELECT",
    ]);
  }

  // Owner-scoped and genuinely written by their owner — exactly four verbs.
  for (const table of OWNER_WRITTEN) {
    expect(held(table, "authenticated"), `authenticated on ${table}`).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  }
}

/**
 * No client role may hold a privilege the engine does not use.
 *
 * A hosted Supabase project grants ALL on every new public table to `anon` and
 * `authenticated`. Migrations that only ever *add* grants leave the rest of
 * that default set in place, and it accumulated on every table created before
 * Iteration 12 — which is invisible to a bare local cluster, because there are
 * no default privileges there to inherit.
 *
 * TRUNCATE is the one that matters most, and the reason this is asserted rather
 * than reviewed: row-level security does not apply to TRUNCATE at all. Every
 * other verb has a policy behind it if the grant is wrong; that one does not.
 *
 * Run against a database built *with* those defaults locally, and against the
 * real project in the hosted tier. The local caller must supply the
 * with-defaults database — asserting this on a plain cluster proves nothing,
 * since the surplus was never there to remove.
 */
export async function expectNoSurplusClientGrants(db: Client): Promise<void> {
  const { rows } = await db.query<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }>(
    `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
  );

  // DDL and TRUNCATE, held by a role that issues neither.
  const surplus = rows.filter((r) =>
    ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"].includes(r.privilege_type),
  );
  expect(
    surplus.map((r) => `${r.grantee} ${r.privilege_type} on ${r.table_name}`).sort(),
    "no client role may hold TRUNCATE, REFERENCES, TRIGGER or MAINTAIN",
  ).toEqual([]);

  // anon reads public reference data and holds nothing else anywhere. Stated
  // as the complete set rather than a per-table check, so a grant on a table
  // nobody thought to list still fails.
  const anon = rows
    .filter((r) => r.grantee === "anon")
    .map((r) => `${r.table_name}:${r.privilege_type}`)
    .sort();
  expect(anon, "anon holds SELECT on reference data and nothing else").toEqual([
    "cost_assumptions:SELECT",
    "country_profiles:SELECT",
  ]);

  // And the required grants are still there: reference data readable,
  // everything else fully writable by its owner under RLS.
  const held = (table: string) =>
    rows
      .filter((r) => r.table_name === table && r.grantee === "authenticated")
      .map((r) => r.privilege_type)
      .sort();

  for (const table of ["country_profiles", "cost_assumptions", "referral_programs"]) {
    expect(held(table), `authenticated on ${table}`).toEqual(["SELECT"]);
  }

  for (const table of [
    "profiles",
    "trips",
    "travelers",
    "document_records",
    "cost_estimates",
    "savings_plans",
    "vault_files",
    "reminders",
    "travel_groups",
    "group_memberships",
    "group_invitations",
    "group_trips",
    "group_tasks",
    "group_task_assignments",
    "group_activities",
    "group_activity_participation",
    "group_dependencies",
  ]) {
    expect(held(table), `authenticated on ${table}`).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  }
}

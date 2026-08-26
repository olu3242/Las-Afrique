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

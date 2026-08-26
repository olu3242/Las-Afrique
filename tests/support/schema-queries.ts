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

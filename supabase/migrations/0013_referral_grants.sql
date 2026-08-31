-- ---------------------------------------------------------------------------
-- Referral grants — tightening what migration 0012 left open.
--
-- What went wrong, and how it was found
-- ------------------------------------
-- A hosted Supabase project sets ALTER DEFAULT PRIVILEGES so that every new
-- table in `public` is granted to `anon` and `authenticated` automatically.
-- Migration 0003 established that, and 0012 accounted for half of it: it
-- revoked `anon` explicitly, then *added* the grants `authenticated` needs.
--
-- Adding a grant does not remove one. So on the hosted project `authenticated`
-- kept the full default set on every referral table — including INSERT, UPDATE
-- and DELETE on `referrals` and `reward_entitlements`, which no client may
-- write at all, and on `referral_programs`, which is reference data with a
-- select-only policy.
--
-- Nothing could actually be written: the policies on those tables are `false`,
-- and RLS refused every attempt. The hosted probe that caught this got a 204
-- with no row changed, not a modified row. But defence in depth is the point
-- of the grant layer — a refusal should land before RLS is consulted, and a
-- surplus grant is one policy edit away from mattering.
--
-- It was invisible to the local tier because a bare cluster has no default
-- privileges to inherit. `tests/schema.test.ts` now reproduces them and
-- asserts the exact privilege set, so the next table cannot repeat it.
--
-- TRUNCATE is in the revoked set deliberately: row-level security does not
-- apply to TRUNCATE at all, so it is the one verb a policy cannot contain.
--
-- Scope: this migration touches the Iteration 12 tables only. The same surplus
-- exists on tables from earlier iterations, which is reported rather than
-- silently widened into this change.
-- ---------------------------------------------------------------------------

-- Read-only to every client. Writes happen only inside attribute_referral and
-- evaluate_referral_qualification, which are security definer.
revoke all on public.referrals            from anon, authenticated;
revoke all on public.reward_entitlements  from anon, authenticated;

-- Reference data: the rules, versioned, never edited through the API. Same
-- shape migration 0008 gave cost_assumptions.
revoke all on public.referral_programs    from anon, authenticated;

grant select on public.referrals           to authenticated;
grant select on public.reward_entitlements to authenticated;
grant select on public.referral_programs   to authenticated;

-- Owner-scoped, and genuinely written by their owner. Re-granted exactly, so
-- the surplus verbs the defaults added are gone.
revoke all on public.referral_codes       from anon, authenticated;
revoke all on public.referral_invitations from anon, authenticated;

grant select, insert, update, delete on public.referral_codes       to authenticated;
grant select, insert, update, delete on public.referral_invitations to authenticated;

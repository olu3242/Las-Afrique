-- ---------------------------------------------------------------------------
-- Revoke anon privileges on tenant tables.
--
-- Why this exists: a hosted Supabase project sets ALTER DEFAULT PRIVILEGES so
-- that tables created in `public` are granted to `anon` and `authenticated`
-- automatically. 0002 granted deliberately to `authenticated` only, but the
-- project's defaults had already granted `anon` as well — so on the hosted
-- project, `anon` held SELECT on every tenant table.
--
-- Row-level security still denied every row (auth.uid() is null for anon, so no
-- policy matched, and PostgREST returned an empty array). Data was never
-- exposed. What was lost is the layer *in front* of RLS: 0002's comments claim
-- denial lands at the grant layer before a policy is consulted, and on the
-- hosted project that was not true.
--
-- This restores that claim. Reference data stays readable — entry requirements
-- are not a secret.
--
-- Found by the first real hosted run; a local cluster has no such default
-- privileges, so no local test could have caught it.
-- ---------------------------------------------------------------------------

revoke all on public.profiles          from anon;
revoke all on public.trips             from anon;
revoke all on public.travelers         from anon;
revoke all on public.document_records  from anon;
revoke all on public.cost_estimates    from anon;
revoke all on public.savings_plans     from anon;
revoke all on public.vault_files       from anon;

-- Stop the project's default privileges from re-granting anon on tables added
-- later. Scoped to the roles that create tables here.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- Reference data remains world-readable, but read-only. The same default
-- privileges had granted anon INSERT/UPDATE/DELETE here too; 0002 defines only a
-- SELECT policy, so RLS refused writes, but the grant had no business existing.
revoke all on public.country_profiles from anon;
grant select on public.country_profiles to anon;

-- `authenticated` is subject to the same defaults. It legitimately needs full
-- access to tenant tables (RLS scopes it to its own rows), but only read access
-- to reference data.
revoke insert, update, delete, truncate on public.country_profiles from authenticated;
grant select on public.country_profiles to authenticated;

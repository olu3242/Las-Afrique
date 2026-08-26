-- ---------------------------------------------------------------------------
-- Local test shim for the parts of Supabase the migrations depend on.
--
-- Supabase provisions the `auth` schema, `auth.users`, `auth.uid()` and the
-- anon / authenticated / service_role roles. A bare Postgres cluster does not,
-- so the test harness creates them here *before* applying migrations.
--
-- This file is never applied to a real Supabase project — it exists so the
-- migrations can run unmodified against plain Postgres and be tested for real.
-- `auth.uid()` mirrors Supabase's implementation exactly, so the policies under
-- test are the same predicates that will run in production.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  created_at    timestamptz not null default now()
);

-- Reads the subject claim the same way Supabase's does: from the request-scoped
-- GUC that PostgREST sets per connection.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;

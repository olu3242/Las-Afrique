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

-- Mirrors the columns of GoTrue's auth.users that this project actually writes,
-- so a seeded-user insert can be rehearsed locally instead of discovered in a
-- hosted run. Not the full table — GoTrue's is much wider — just the subset the
-- probes touch.
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default gen_random_uuid(),
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- GoTrue scans these into non-nullable Go strings. Present here so the
  -- seeded-user backfill is rehearsed rather than discovered in a hosted run.
  confirmation_token      varchar(255),
  recovery_token          varchar(255),
  email_change_token_new  varchar(255),
  email_change            varchar(255),
  phone_change            varchar(255),
  phone_change_token      varchar(255),
  reauthentication_token  varchar(255)
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

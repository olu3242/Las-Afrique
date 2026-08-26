-- ---------------------------------------------------------------------------
-- Local test shim for the parts of Supabase Storage the migrations depend on.
--
-- Same reasoning as the auth shim next to it: Supabase provisions the storage
-- schema, its buckets and objects tables, and storage.foldername(). A bare
-- Postgres cluster does not, so 0009 could not be rehearsed locally without
-- this and would be discovered broken by a hosted run instead.
--
-- storage.foldername mirrors Supabase's implementation exactly — it returns
-- every path segment except the last, so `(foldername('uid/a/b.pdf'))[1]` is
-- 'uid'. The policies under test compare that to auth.uid(), so a shim that
-- got this wrong would test the wrong predicate.
-- ---------------------------------------------------------------------------

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id            uuid primary key default gen_random_uuid(),
  bucket_id     text references storage.buckets (id),
  name          text,
  owner         uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  metadata      jsonb,
  constraint storage_objects_bucket_name_unique unique (bucket_id, name)
);

-- Supabase enables RLS on storage.objects; without it the policies the
-- migration creates would exist but never be consulted, and the test would
-- pass while proving nothing.
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;

-- Supabase grants broadly here and lets RLS do the scoping, so the shim does
-- the same. Granting less would make the local tests pass for a reason the
-- hosted project does not share — the policies would never be reached, and a
-- broken policy would look secure.
grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.objects to anon;

-- ---------------------------------------------------------------------------
-- Take Me Home — initial domain schema
--
-- Ownership model: every tenant-scoped table carries `user_id` referencing
-- auth.users. Policies compare it to auth.uid() directly rather than walking a
-- foreign key chain — one indexed predicate per table, and no policy that can be
-- defeated by re-parenting a row.
--
-- Reference data (country_profiles) is world-readable and writable only by the
-- service role.
--
-- No business logic lives here. Cost calculation, readiness derivation and
-- country intelligence arrive in later iterations.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type public.trip_purpose as enum (
  'homecoming', 'family_visit', 'ceremony', 'business', 'other'
);

create type public.trip_status as enum (
  'draft', 'planning', 'ready', 'travelled', 'cancelled'
);

-- 'verify_required' is the default for anything we cannot substantiate from a
-- verified source. Unknown must stay unknown; it must never decay into 'ready'.
create type public.readiness_state as enum (
  'ready', 'action_needed', 'upcoming', 'missing', 'expiring', 'verify_required'
);

create type public.document_kind as enum (
  'passport', 'visa', 'entry_permit', 'travel_health_record',
  'return_ticket', 'proof_of_accommodation', 'travel_insurance', 'other'
);

create type public.accommodation_tier as enum (
  'staying_with_family', 'budget', 'midrange', 'premium'
);

create type public.verification_state as enum (
  'unverified', 'verified', 'stale'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one per auth user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  home_country  text,
  home_currency char(3),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- country_profiles — public reference data, not tenant-scoped
-- ---------------------------------------------------------------------------

create table public.country_profiles (
  key                     text primary key,
  name                    text not null,
  currency                char(3) not null,
  sort_order              integer not null,
  major_cities            text[] not null default '{}',
  visa_entry_info         jsonb,
  passport_considerations jsonb,
  emergency_info          jsonb,
  customs_notes           jsonb,
  advisories              jsonb,
  source_name             text,
  source_url              text,
  last_verified_at        timestamptz,
  verification_state      public.verification_state not null default 'unverified',
  data_version            integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint country_profiles_sort_order_unique unique (sort_order)
);

create trigger country_profiles_set_updated_at
  before update on public.country_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------

create table public.trips (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  origin_country          text,
  origin_city             text,
  destination_country_key text references public.country_profiles (key),
  destination_city        text,
  depart_on               date,
  return_on               date,
  purpose                 public.trip_purpose,
  party_size              integer,
  accommodation_tier      public.accommodation_tier,
  status                  public.trip_status not null default 'draft',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint trips_party_size_positive
    check (party_size is null or party_size > 0),
  constraint trips_dates_ordered
    check (depart_on is null or return_on is null or return_on >= depart_on)
);

create index trips_user_id_idx on public.trips (user_id);
create index trips_destination_idx on public.trips (destination_country_key);

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- travelers
-- ---------------------------------------------------------------------------

create table public.travelers (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.trips (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  full_name             text not null,
  relationship          text,
  is_primary            boolean not null default false,
  -- Deliberately not the full number. Take Me Home has no reason to hold a
  -- complete passport number, and holding one is a liability.
  passport_last4        text,
  passport_expires_on   date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint travelers_passport_last4_shape
    check (passport_last4 is null or passport_last4 ~ '^[A-Za-z0-9]{4}$')
);

create index travelers_trip_id_idx on public.travelers (trip_id);
create index travelers_user_id_idx on public.travelers (user_id);

create trigger travelers_set_updated_at
  before update on public.travelers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_records
-- ---------------------------------------------------------------------------

create table public.document_records (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  traveler_id  uuid references public.travelers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         public.document_kind not null,
  state        public.readiness_state not null default 'verify_required',
  due_on       date,
  note         text,
  source_name  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index document_records_trip_id_idx on public.document_records (trip_id);
create index document_records_traveler_id_idx on public.document_records (traveler_id);
create index document_records_user_id_idx on public.document_records (user_id);

create trigger document_records_set_updated_at
  before update on public.document_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cost_estimates — engine output, never LLM output
-- ---------------------------------------------------------------------------

create table public.cost_estimates (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  currency        char(3) not null,
  estimate_low    numeric(12, 2),
  estimate_high   numeric(12, 2),
  planning_target numeric(12, 2),
  categories      jsonb not null default '[]'::jsonb,
  assumptions     jsonb not null default '[]'::jsonb,
  confidence      text,
  -- Which engine version produced this, so any figure can be traced back to the
  -- rules that generated it.
  engine_version  text not null,
  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint cost_estimates_range_ordered
    check (estimate_low is null or estimate_high is null or estimate_high >= estimate_low)
);

create index cost_estimates_trip_id_idx on public.cost_estimates (trip_id);
create index cost_estimates_user_id_idx on public.cost_estimates (user_id);

-- ---------------------------------------------------------------------------
-- savings_plans
-- ---------------------------------------------------------------------------

create table public.savings_plans (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  currency         char(3) not null,
  target_amount    numeric(12, 2),
  amount_saved     numeric(12, 2) not null default 0,
  monthly_target   numeric(12, 2),
  months_remaining integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint savings_plans_amount_saved_non_negative check (amount_saved >= 0),
  constraint savings_plans_one_per_trip unique (trip_id)
);

create index savings_plans_user_id_idx on public.savings_plans (user_id);

create trigger savings_plans_set_updated_at
  before update on public.savings_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- vault_files — metadata only; bytes live in object storage
-- ---------------------------------------------------------------------------

create table public.vault_files (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  trip_id            uuid references public.trips (id) on delete cascade,
  traveler_id        uuid references public.travelers (id) on delete set null,
  document_record_id uuid references public.document_records (id) on delete set null,
  storage_path       text not null unique,
  file_name          text not null,
  mime_type          text,
  byte_size          bigint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vault_files_byte_size_non_negative
    check (byte_size is null or byte_size >= 0)
);

create index vault_files_user_id_idx on public.vault_files (user_id);
create index vault_files_trip_id_idx on public.vault_files (trip_id);

create trigger vault_files_set_updated_at
  before update on public.vault_files
  for each row execute function public.set_updated_at();

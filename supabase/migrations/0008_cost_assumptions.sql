-- ---------------------------------------------------------------------------
-- The inputs the Cost Estimation Engine computes from.
--
-- The PRD is explicit that the LLM does not produce cost figures: a
-- deterministic engine computes every number from structured inputs. This is
-- where those structured inputs live, so a figure can always be traced to the
-- rate that produced it.
--
-- Rates carry a `basis`, and the distinction is the whole point:
--
--   illustrative — a planning placeholder. Not a market price, not researched,
--                  and every surface showing a figure derived from one has to
--                  say so.
--   verified     — sourced, with a name, a URL and a date, under the same rule
--                  0007 applies to country requirements.
--
-- Seeding illustrative rates is honest; seeding them as `verified` would not
-- be, and the constraint below makes that impossible rather than discouraged.
--
-- Reference data, like country_profiles: world-readable, written only by the
-- service role.
-- ---------------------------------------------------------------------------

create type public.cost_category as enum (
  'flights',
  'accommodation',
  'food',
  'local_transport',
  'visa_and_documents',
  'travel_insurance',
  'activities',
  'family_and_shopping',
  'contingency'
);

-- How a rate scales. The engine multiplies by whichever quantity this names,
-- so the unit is part of the data rather than a rule hidden in code.
create type public.cost_unit as enum (
  'per_person_per_trip',
  'per_person_per_night',
  'per_trip',
  'percent_of_subtotal'
);

create type public.assumption_basis as enum ('illustrative', 'verified');

create table public.cost_assumptions (
  id                uuid primary key default gen_random_uuid(),
  -- Null means "applies to any destination without its own rate". A country
  -- specific row overrides the default for that country.
  country_key       text references public.country_profiles (key) on delete cascade,
  category          public.cost_category not null,
  unit              public.cost_unit not null,
  currency          char(3) not null,
  amount_low        numeric(12, 2) not null,
  amount_high       numeric(12, 2) not null,
  basis             public.assumption_basis not null default 'illustrative',
  note              text,
  source_name       text,
  source_url        text,
  last_verified_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cost_assumptions_range_ordered check (amount_high >= amount_low),
  constraint cost_assumptions_non_negative check (amount_low >= 0),

  -- One rate per category per country, and one default per category.
  constraint cost_assumptions_unique_scope unique (country_key, category),

  -- The same rule 0007 applies to country claims: nothing may present itself
  -- as verified without saying who verified it and when.
  constraint cost_assumptions_verified_needs_provenance check (
    basis <> 'verified'
    or (
      source_name is not null
      and source_url is not null
      and last_verified_at is not null
    )
  ),
  constraint cost_assumptions_source_url_is_http check (
    source_url is null or source_url ~ '^https?://'
  ),
  constraint cost_assumptions_verified_at_not_future check (
    last_verified_at is null or last_verified_at <= now()
  )
);

create index cost_assumptions_country_idx on public.cost_assumptions (country_key);

create trigger cost_assumptions_set_updated_at
  before update on public.cost_assumptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: reference data, not tenant data.
-- ---------------------------------------------------------------------------

alter table public.cost_assumptions enable row level security;

create policy cost_assumptions_select_all on public.cost_assumptions
  for select using (true);

-- No insert/update/delete policy, so writes are denied to every role except
-- the service role, which bypasses RLS.

revoke all on public.cost_assumptions from anon, authenticated;
grant select on public.cost_assumptions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Illustrative defaults.
--
-- These are planning placeholders, not market prices, and they are identical
-- for every destination on purpose: a per-country number would be a claim
-- about that country's costs, which is exactly the kind of thing this project
-- does not invent. They exist so the engine has something deterministic to
-- compute from, and every figure derived from them is labelled illustrative
-- all the way to the screen.
--
-- Verified per-country rates replace them by inserting a row with the same
-- category and a country_key.
-- ---------------------------------------------------------------------------

insert into public.cost_assumptions
  (country_key, category, unit, currency, amount_low, amount_high, note)
values
  (null, 'flights',             'per_person_per_trip',  'USD',  600,  1400, 'Return economy fare, booked in advance'),
  (null, 'accommodation',       'per_person_per_night', 'USD',   25,   120, 'Mid-range; lower when staying with family'),
  (null, 'food',                'per_person_per_night', 'USD',   15,    45, 'Mix of eating in and out'),
  (null, 'local_transport',     'per_person_per_night', 'USD',    8,    30, 'Taxis and ride-hailing'),
  (null, 'visa_and_documents',  'per_person_per_trip',  'USD',    0,   250, 'Varies widely; check the country guide'),
  (null, 'travel_insurance',    'per_person_per_trip',  'USD',   40,   120, 'Single-trip cover'),
  (null, 'activities',          'per_person_per_trip',  'USD',   50,   400, 'Events, ceremonies and outings'),
  (null, 'family_and_shopping', 'per_person_per_trip',  'USD',  200,  1000, 'Gifts and contributions'),
  (null, 'contingency',         'percent_of_subtotal',  'USD',   10,    15, 'Buffer applied to everything above');

-- ---------------------------------------------------------------------------
-- A country claim cannot exist without a source.
--
-- The PRD states it as a rule: "Take Me Home surfaces requirements; it is not
-- the authority on them. Every guide shows when it was last checked." A rule
-- written in a document is a rule someone can forget at 2am with a data load to
-- finish. These constraints make it one the database refuses to break.
--
-- Why this matters more than most integrity rules: a hallucinated flight price
-- loses trust, but a hallucinated visa requirement makes someone miss a flight,
-- or worse. This is a safety property, not tidiness.
--
-- Two constraints, saying different things:
--
--   1. Nothing may be marked `verified` without a named source, a URL and a
--      date it was checked. "Verified" with no evidence is the exact claim the
--      product must never make.
--
--   2. No requirement content may be stored at all — visa, passport,
--      emergency, customs, advisories — unless that same provenance is
--      present. This is the stronger one: it means a row physically cannot
--      hold a statement about what a country requires while being unable to
--      say who said so and when.
--
-- 0005's seeded rows satisfy both by carrying no claims at all, which is why
-- they could be added honestly before any source existed.
-- ---------------------------------------------------------------------------

alter table public.country_profiles
  add constraint country_profiles_verified_needs_provenance
  check (
    verification_state <> 'verified'
    or (
      source_name is not null
      and source_url is not null
      and last_verified_at is not null
    )
  );

alter table public.country_profiles
  add constraint country_profiles_claims_need_provenance
  check (
    (
      visa_entry_info is null
      and passport_considerations is null
      and emergency_info is null
      and customs_notes is null
      and advisories is null
    )
    or (
      source_name is not null
      and source_url is not null
      and last_verified_at is not null
    )
  );

-- A source URL has to be one a traveller can actually open and check. Anything
-- else is provenance in name only.
alter table public.country_profiles
  add constraint country_profiles_source_url_is_http
  check (source_url is null or source_url ~ '^https?://');

-- Checked-in-the-future is not a date anything was checked on. Guards a
-- timezone slip or a bad import from producing a guide that looks permanently
-- fresh.
alter table public.country_profiles
  add constraint country_profiles_verified_at_not_future
  check (last_verified_at is null or last_verified_at <= now());

comment on constraint country_profiles_claims_need_provenance
  on public.country_profiles is
  'A statement about what a country requires cannot be stored without naming '
  'the source it came from and the date it was checked.';

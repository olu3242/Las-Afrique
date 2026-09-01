-- Public launch waitlist.
--
-- A visitor may add an address, but neither anon nor authenticated clients may
-- read, update, or delete the list. Duplicate submissions are collapsed by the
-- database. The application deliberately reports the same success state for a
-- new and an existing address so this endpoint cannot be used to enumerate it.

create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalised text
    generated always as (public.normalise_email(email)) stored,
  source text not null default 'marketing-site'
    check (source in ('marketing-site')),
  created_at timestamptz not null default now(),

  constraint waitlist_signups_email_shape
    check (email = trim(email) and position('@' in email) > 1),
  constraint waitlist_signups_email_unique unique (email_normalised)
);

alter table public.waitlist_signups enable row level security;
alter table public.waitlist_signups force row level security;

create policy waitlist_signups_anon_insert
  on public.waitlist_signups
  for insert
  to anon
  with check (source = 'marketing-site');

revoke all on table public.waitlist_signups from anon, authenticated;
grant insert (email, source) on table public.waitlist_signups to anon;


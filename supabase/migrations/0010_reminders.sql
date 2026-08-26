-- ---------------------------------------------------------------------------
-- Reminders: the audit trail for anything the product sends a traveller.
--
-- The table is the idempotency mechanism, not a log written after the fact.
-- A scheduled job that runs twice — a retry, an overlapping tick, a replayed
-- queue message — must not send the same reminder twice, and the only way to
-- guarantee that across process restarts is to make the database refuse the
-- duplicate.
--
-- `dedupe_key` is that guarantee. It is derived from what the reminder is
-- about rather than from when the job ran, so two runs computing the same
-- deadline compute the same key and the second insert loses.
--
-- Deadlines are not stored here as a second source of truth. The readiness
-- engine owns them; this records what was sent about them.
-- ---------------------------------------------------------------------------

create type public.reminder_channel as enum ('email', 'push', 'in_app');

create type public.reminder_status as enum (
  'pending',
  'sent',
  'failed',
  'cancelled'
);

create table public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  trip_id      uuid references public.trips (id) on delete cascade,

  -- What the reminder is about, in the readiness engine's own terms.
  subject      text not null,
  body         text not null,
  channel      public.reminder_channel not null default 'in_app',

  -- When it should go out. Derived from a deadline the readiness engine
  -- produced, never invented here.
  due_at       timestamptz not null,

  status       public.reminder_status not null default 'pending',
  attempts     integer not null default 0,
  last_error   text,
  sent_at      timestamptz,

  /**
   * The idempotency key. Stable for a given (trip, item, deadline), so a job
   * that runs twice produces the same key both times.
   */
  dedupe_key   text not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint reminders_attempts_non_negative check (attempts >= 0),
  -- A reminder is sent exactly when it has a sent_at, and not otherwise.
  constraint reminders_sent_has_timestamp check (
    (status = 'sent') = (sent_at is not null)
  ),
  -- Per user, not globally: two travellers can legitimately be reminded about
  -- the same deadline on the same trip if they ever share one.
  constraint reminders_dedupe_unique unique (user_id, dedupe_key),
  -- Matches the composite key discipline from 0006.
  constraint reminders_trip_fk
    foreign key (trip_id, user_id) references public.trips (id, user_id)
    on delete cascade
);

create index reminders_due_idx on public.reminders (due_at)
  where status = 'pending';
create index reminders_user_idx on public.reminders (user_id);

create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security. Tenant-scoped, enabled and forced, all four verbs.
-- ---------------------------------------------------------------------------

alter table public.reminders enable row level security;
alter table public.reminders force row level security;

create policy reminders_select_own on public.reminders
  for select using (user_id = auth.uid());
create policy reminders_insert_own on public.reminders
  for insert with check (user_id = auth.uid());
create policy reminders_update_own on public.reminders
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reminders_delete_own on public.reminders
  for delete using (user_id = auth.uid());

revoke all on public.reminders from anon;
grant select, insert, update, delete on public.reminders to authenticated;

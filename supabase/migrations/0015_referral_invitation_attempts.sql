-- ---------------------------------------------------------------------------
-- Invitation rate limit — the approved decision, implemented properly.
--
-- The product owner resolved decision 4 as:
--
--   "10 invitation attempts per referrer per rolling hour. Refused attempts
--    count toward the limit so invalid-address probing cannot bypass it."
--
-- (PR #19, docs/ITERATION-12-DECISIONS.md.)
--
-- Migration 0012 seeded 20 per rolling *day*, a number this codebase invented
-- because the scope document left `[DECISION: limit]` unresolved. Both halves
-- of that were wrong once the real decision existed, and the second half was
-- wrong in the way that matters:
--
--   `guard_referral_invitation_rate` counts rows in `referral_invitations`.
--   A refused insert leaves no row, so a refused attempt cost the prober
--   nothing. Someone could submit addresses indefinitely and learn, from which
--   ones were refused by the one-pending-per-address index, who a referrer had
--   already invited. That is exactly the bypass the decision names.
--
-- Counting attempts requires recording them, so this adds a table that a
-- refusal cannot roll back — written by its own statement, through its own
-- definer function, before the invitation insert is attempted. Each PostgREST
-- call is its own transaction, so the attempt survives whatever the insert
-- then does.
--
-- The trigger stays, narrowed to the same rolling hour and the same limit. It
-- is no longer the primary gate; it bounds any path that reaches the table
-- without claiming an attempt first.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The programme's limit, renamed to what it now means.
--
-- Added, backfilled, then the old column dropped, rather than left in place
-- holding an hourly number under a daily name. A column whose name lies is
-- worse than a column that is gone: the next reader trusts the name.
-- ---------------------------------------------------------------------------

alter table public.referral_programs
  add column invitation_rate_limit_per_hour integer;

update public.referral_programs
   set invitation_rate_limit_per_hour = 10
 where invitation_rate_limit_per_hour is null;

alter table public.referral_programs
  alter column invitation_rate_limit_per_hour set not null,
  add constraint referral_programs_hourly_limit_range
    check (invitation_rate_limit_per_hour between 1 and 1000);

alter table public.referral_programs
  drop column invitation_rate_limit_per_day;

-- ---------------------------------------------------------------------------
-- referral_invitation_attempts
--
-- One row per attempt, kept whether or not the invitation was created. That is
-- the whole point: an attempt that leaves no trace is an attempt that does not
-- count.
--
-- Readable by the referrer — it is their own activity, and a limit somebody
-- cannot see the shape of is one they cannot understand hitting. Writable by
-- nobody directly: the counting and the insert have to happen together or the
-- limit is advisory.
-- ---------------------------------------------------------------------------

create table public.referral_invitation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_key text not null references public.referral_programs (key),
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index referral_invitation_attempts_user_idx
  on public.referral_invitation_attempts (user_id, attempted_at desc);

alter table public.referral_invitation_attempts enable row level security;
alter table public.referral_invitation_attempts force row level security;

create policy referral_invitation_attempts_select_own
  on public.referral_invitation_attempts
  for select using (user_id = auth.uid());
create policy referral_invitation_attempts_insert_none
  on public.referral_invitation_attempts
  for insert with check (false);
create policy referral_invitation_attempts_update_none
  on public.referral_invitation_attempts
  for update using (false) with check (false);
create policy referral_invitation_attempts_delete_none
  on public.referral_invitation_attempts
  for delete using (false);

revoke all on public.referral_invitation_attempts from anon, authenticated;
grant select on public.referral_invitation_attempts to authenticated;

-- ---------------------------------------------------------------------------
-- claim_referral_invitation_attempt
--
-- Records the attempt, then answers whether it is allowed. In that order, so
-- the attempt being made is itself counted — a caller cannot learn they are at
-- the ceiling and retry for free.
--
-- Definer because no client may write this table: a rate limit a caller can
-- delete rows from is not a rate limit.
-- ---------------------------------------------------------------------------

create or replace function public.claim_referral_invitation_attempt()
returns table (outcome text, used integer, allowance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  program public.referral_programs%rowtype;
  attempts integer;
begin
  if caller is null then
    return query select 'invalid'::text, 0, 0;
    return;
  end if;

  select * into program from public.referral_programs p
   where p.effective_to is null;

  if not found then
    return query select 'no_program'::text, 0, 0;
    return;
  end if;

  insert into public.referral_invitation_attempts (user_id, program_key)
  values (caller, program.key);

  select count(*) into attempts
    from public.referral_invitation_attempts a
   where a.user_id = caller
     and a.attempted_at > now() - interval '1 hour';

  if attempts > program.invitation_rate_limit_per_hour then
    return query
      select 'rate_limited'::text, attempts, program.invitation_rate_limit_per_hour;
    return;
  end if;

  return query
    select 'allowed'::text, attempts, program.invitation_rate_limit_per_hour;
end;
$$;

revoke execute on function public.claim_referral_invitation_attempt() from public;
grant execute on function public.claim_referral_invitation_attempt() to authenticated;

-- ---------------------------------------------------------------------------
-- guard_referral_invitation_rate, narrowed to the rolling hour.
--
-- No longer the primary gate — attempts are — but it still bounds any path
-- that reaches the table without claiming one first. Replaced rather than
-- edited in place: 0012 is applied and stays as it was.
-- ---------------------------------------------------------------------------

create or replace function public.guard_referral_invitation_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance integer;
  sent_recently integer;
begin
  if auth.uid() is null then return new; end if;

  select p.invitation_rate_limit_per_hour into allowance
    from public.referral_programs p where p.key = new.program_key;

  if allowance is null then return new; end if;

  select count(*) into sent_recently
    from public.referral_invitations i
   where i.user_id = new.user_id
     and i.created_at > now() - interval '1 hour';

  if sent_recently >= allowance then
    raise exception 'referral_invitation_rate_limit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

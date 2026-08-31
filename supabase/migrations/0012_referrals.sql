-- ---------------------------------------------------------------------------
-- Referral — Phase 2, Iteration 12.
--
-- Who introduced whom, whether it counted, and what that earned under the
-- policy in force at the time. Scope approved in docs/ITERATION-12-SCOPE.md.
--
-- The separation this rests on
-- ----------------------------
-- Referral and reward are two mechanisms. This migration builds the first and
-- the *entitlement boundary* of the second. It does not build fulfilment, and
-- it records no money.
--
--   NON-CUSTODIAL INVARIANT
--   No table here may record a monetary balance, an amount owed, a transfer,
--   or a settlement state.
--
-- A reward_entitlements row says "this person earned something under policy X
-- at time T". It carries no amount and no currency. If a policy's benefit has
-- a monetary value, that value is a property of the policy description held
-- outside this engine, never a liability recorded against a user. PRD §8: the
-- product does not hold money. `expectNoCustodyColumns` asserts it rather than
-- leaving it to review, because that drift arrives one innocuous column at a
-- time.
--
-- The privacy boundary
-- --------------------
-- A referrer learns three things and no more: that an address they themselves
-- invited reached JOINED, that it later reached QUALIFIED, and counts over
-- their own referrals. Nothing here reads, joins to, or exposes the referred
-- user's trip, travellers, documents, budget, vault or readiness. No policy
-- below mentions any of those tables, and none may be added that does — the
-- same rule Iteration 11 established, inherited rather than restated.
--
-- `referrals` is readable by *either* party. The referred user can always see
-- who was credited for introducing them: being the subject of an attribution
-- you cannot inspect is not a position to put someone in. That is a two-column
-- disjunction on the row itself, not a lookup, so unlike Iteration 11's
-- membership predicate it needs no definer helper to avoid recursion.
--
-- Why the writes go through definer functions
-- -------------------------------------------
-- Attribution and qualification are the two places where a user must cause a
-- row to change in a way they must not be able to dictate:
--
--   * Attribution names a referrer the referred user cannot read (codes are
--     owner-scoped). Left to a direct insert, a user could name anybody as
--     their referrer, which forges the provenance the whole engine exists to
--     establish.
--   * Qualification must depend on the referred user having actually done the
--     qualifying thing. Evaluated inside a definer function against the real
--     tables, it cannot be claimed — only earned.
--
-- So `referrals` and `reward_entitlements` are readable by their parties and
-- writable by nobody directly: their insert and update policies are `false`,
-- stated explicitly rather than left to an absent policy, so the refusal is
-- visible in the schema and testable.
-- ---------------------------------------------------------------------------

create type public.referral_state as enum ('joined', 'qualified', 'disqualified');

create type public.referral_invitation_state as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

-- What a programme requires before a referral counts. The approved programme
-- uses `first_trip_created`; the others exist so a later programme version can
-- move the bar without a schema change.
create type public.referral_qualification_predicate as enum (
  'account_created',
  'first_trip_created',
  'first_trip_with_destination_and_dates'
);

-- ---------------------------------------------------------------------------
-- normalise_email
--
-- One definition of "the same address", used by the self-referral refusal and
-- by the duplicate-invitation index. Immutable, so it can back a generated
-- column and a unique index.
--
-- Plus-addressing is stripped everywhere because every major provider treats
-- it as a tag rather than a different mailbox. Dots are stripped only for the
-- providers that genuinely ignore them — doing it universally would merge two
-- distinct mailboxes at providers that do not, which is a worse error than
-- missing a duplicate.
-- ---------------------------------------------------------------------------

create or replace function public.normalise_email(address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when address is null or position('@' in address) < 2 then lower(trim(address))
    else (
      with parts as (
        select
          split_part(lower(trim(address)), '@', 1) as local_part,
          split_part(lower(trim(address)), '@', 2) as domain
      ),
      tagged as (
        select
          case when position('+' in local_part) > 0
               then split_part(local_part, '+', 1)
               else local_part end as local_part,
          domain
        from parts
      )
      select case
        when domain in ('gmail.com', 'googlemail.com')
          then replace(local_part, '.', '') || '@' || domain
        else local_part || '@' || domain
      end
      from tagged
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- referral_programs
--
-- Reference data, not tenant data — the rules, versioned. Never edited in
-- place: an entitlement earned in March has to stay interpretable in September
-- against the rules that were actually in force, and rewriting a row would
-- silently restate history.
--
-- Ending a programme means setting `effective_to` and inserting the next one.
-- The partial unique index below permits exactly one open-ended programme, so
-- "the programme in force" is a single row rather than a guess.
-- ---------------------------------------------------------------------------

create table public.referral_programs (
  key text primary key check (key ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (length(trim(name)) between 1 and 120),

  qualification_predicate public.referral_qualification_predicate not null,
  attribution_window_days integer not null
    check (attribution_window_days between 1 and 365),
  invitation_rate_limit_per_day integer not null
    check (invitation_rate_limit_per_day between 1 and 1000),

  -- Names which benefit applies. It does not describe a payment, and nothing
  -- in this schema interprets it — fulfilment is a separate, separately
  -- authorised adapter that reads this key and does whatever it means.
  reward_policy_key text not null check (length(trim(reward_policy_key)) between 1 and 60),

  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referral_programs_window_ordered
    check (effective_to is null or effective_to > effective_from)
);

create unique index referral_programs_one_in_force
  on public.referral_programs ((true)) where effective_to is null;

create trigger referral_programs_set_updated_at
  before update on public.referral_programs
  for each row execute function public.set_updated_at();

-- The approved Iteration 12 policy values.
--
--   qualification            first trip created
--   attribution window       30 days
--   attribution model        last touch within the window (see attribute_referral)
--   invitation rate limit    see docs/ITERATION-12-SCOPE.md §6 — the scope left
--                            no number, so 20/day is seeded as a starting
--                            value and is changed by ending this programme and
--                            inserting the next, not by editing this row
--   disposable addresses     not policed (no blocklist exists here by design)
insert into public.referral_programs
  (key, name, qualification_predicate, attribution_window_days,
   invitation_rate_limit_per_day, reward_policy_key)
values
  ('launch', 'Launch referral programme', 'first_trip_created', 30, 20,
   'recognition-only')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- referral_codes
--
-- A member's shareable string. One per person per programme, enforced by the
-- schema so `ensureReferralCode` is idempotent by construction rather than by
-- a read-then-write that races itself.
-- ---------------------------------------------------------------------------

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_key text not null references public.referral_programs (key),
  code text not null check (code ~ '^[A-Z0-9]{8,16}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referral_codes_one_per_program unique (user_id, program_key),
  constraint referral_codes_unique unique (code)
);

create index referral_codes_user_idx on public.referral_codes (user_id);

create trigger referral_codes_set_updated_at
  before update on public.referral_codes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- referral_invitations
--
-- "I sent my code to this address." Optional — a code shared in a group chat
-- attributes perfectly well with no invitation behind it, which is why
-- `referrals` rather than this table is the spine.
--
-- The token is stored hashed, like Iteration 11's group invitations: a row
-- readable by its sender must not hand them a working credential, and a
-- database read must not yield one either.
-- ---------------------------------------------------------------------------

create table public.referral_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_key text not null references public.referral_programs (key),
  email text not null check (position('@' in email) > 1),
  email_normalised text
    generated always as (public.normalise_email(email)) stored,
  token_hash text not null,
  state public.referral_invitation_state not null default 'pending',
  accepted_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referral_invitations_accepted_has_actor
    check (state <> 'accepted' or accepted_by is not null)
);

-- A second pending invite to the same address is refused by the schema rather
-- than by a read-then-write. Normalised, so "ama+home@gmail.com" does not slip
-- past a check on "ama@gmail.com".
create unique index referral_invitations_one_pending_per_address
  on public.referral_invitations (user_id, email_normalised)
  where state = 'pending';

create index referral_invitations_user_idx on public.referral_invitations (user_id);
create index referral_invitations_token_idx on public.referral_invitations (token_hash);

create trigger referral_invitations_set_updated_at
  before update on public.referral_invitations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- referrals — the spine
--
-- One row per referred user, for all time. That is a unique constraint rather
-- than a rule in application code, so a second attribution is refused by the
-- database under concurrency rather than by whichever request read first.
--
-- A row here means a signup happened and was attributed. The INVITED step of
-- the lifecycle the referrer sees is an invitation with no referral yet, so it
-- is composed in the domain layer rather than stored as a state this table can
-- never actually hold.
-- ---------------------------------------------------------------------------

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references public.referral_programs (key),
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  invitation_id uuid references public.referral_invitations (id) on delete set null,

  state public.referral_state not null default 'joined',

  -- Provenance: which string was resolved, and when the touch happened. Both
  -- are what make an attribution auditable after the fact rather than a
  -- relationship of unknown origin.
  code text not null,
  touched_at timestamptz not null,
  attributed_at timestamptz not null default now(),

  qualified_at timestamptz,
  disqualified_at timestamptz,
  disqualified_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referrals_one_per_referred_user unique (referred_user_id),
  constraint referrals_no_self_referral check (referrer_id <> referred_user_id),
  constraint referrals_touch_precedes_attribution check (attributed_at >= touched_at),
  constraint referrals_qualified_has_time
    check (state <> 'qualified' or qualified_at is not null),
  constraint referrals_disqualified_has_time
    check (state <> 'disqualified' or disqualified_at is not null)
);

create index referrals_referrer_idx on public.referrals (referrer_id);

create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reward_entitlements
--
-- "Earned under policy X at time T." No amount. No currency. No balance.
--
-- A reversal marks `revoked_at` and leaves the row. An entitlement that
-- silently vanishes is indistinguishable from a bug — to the user and to us.
-- ---------------------------------------------------------------------------

create table public.reward_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  referral_id uuid not null references public.referrals (id) on delete cascade,
  program_key text not null references public.referral_programs (key),
  reward_policy_key text not null,
  earned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One entitlement per referral, so a repeated qualification evaluation
  -- cannot mint a second.
  constraint reward_entitlements_one_per_referral unique (referral_id)
);

create index reward_entitlements_user_idx on public.reward_entitlements (user_id);

create trigger reward_entitlements_set_updated_at
  before update on public.reward_entitlements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invitation rate limit
--
-- Enforced in the database rather than in the action, so it holds for every
-- path that inserts. The limit is programme data, so changing it is a
-- programme version rather than a code change.
--
-- Two concurrent inserts at the boundary can both pass under READ COMMITTED,
-- so this is a flood control rather than an exact quota. That is the right
-- trade: the alternative is serialising every invitation behind a table lock
-- to make an anti-abuse threshold precise to one.
--
-- `auth.uid() is null` means the service role, a migration or the table owner
-- — all of which already bypass RLS by design, and none of which is a member
-- flooding invitations. Iteration 11 learned this the hard way with a guard
-- trigger that silently reverted service-role writes.
-- ---------------------------------------------------------------------------

create or replace function public.guard_referral_invitation_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_per_day integer;
  sent_today integer;
begin
  if auth.uid() is null then return new; end if;

  select p.invitation_rate_limit_per_day into limit_per_day
    from public.referral_programs p where p.key = new.program_key;

  if limit_per_day is null then return new; end if;

  select count(*) into sent_today
    from public.referral_invitations i
   where i.user_id = new.user_id
     and i.created_at > now() - interval '1 day';

  if sent_today >= limit_per_day then
    raise exception 'referral_invitation_rate_limit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger referral_invitations_rate_limit
  before insert on public.referral_invitations
  for each row execute function public.guard_referral_invitation_rate();

-- ---------------------------------------------------------------------------
-- Attribution immutability
--
-- An attribution may be disqualified. It may never be re-pointed at a
-- different referrer, and a qualified one may never quietly become unqualified
-- — the only exit from `qualified` is `disqualified`, which is a reversal with
-- a reason and a timestamp rather than a deletion.
-- ---------------------------------------------------------------------------

create or replace function public.guard_referral_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referrer_id <> old.referrer_id
     or new.referred_user_id <> old.referred_user_id
     or new.program_key <> old.program_key
     or new.code <> old.code
     or new.touched_at <> old.touched_at
     or new.attributed_at <> old.attributed_at then
    raise exception 'referral_attribution_is_immutable'
      using errcode = 'check_violation';
  end if;

  if old.state = 'qualified' and new.state = 'joined' then
    raise exception 'referral_qualification_is_terminal'
      using errcode = 'check_violation';
  end if;

  if old.state = 'disqualified' and new.state <> 'disqualified' then
    raise exception 'referral_disqualification_is_terminal'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger referrals_guard_immutability
  before update on public.referrals
  for each row execute function public.guard_referral_immutability();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.referral_programs enable row level security;

-- Reference data: readable, never writable through the API. Matches the shape
-- 0002 gave country_profiles.
create policy referral_programs_select_all on public.referral_programs
  for select using (true);

alter table public.referral_codes enable row level security;
alter table public.referral_codes force row level security;

create policy referral_codes_select_own on public.referral_codes
  for select using (user_id = auth.uid());
create policy referral_codes_insert_own on public.referral_codes
  for insert with check (user_id = auth.uid());
create policy referral_codes_update_own on public.referral_codes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy referral_codes_delete_own on public.referral_codes
  for delete using (user_id = auth.uid());

alter table public.referral_invitations enable row level security;
alter table public.referral_invitations force row level security;

-- The sender's own invitations, and nobody else's. An invitee has no read
-- here at all — the token in their link is the authorization, resolved by the
-- definer function below, exactly as Iteration 11 handles group invitations.
create policy referral_invitations_select_own on public.referral_invitations
  for select using (user_id = auth.uid());
create policy referral_invitations_insert_own on public.referral_invitations
  for insert with check (user_id = auth.uid());
create policy referral_invitations_update_own on public.referral_invitations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy referral_invitations_delete_own on public.referral_invitations
  for delete using (user_id = auth.uid());

alter table public.referrals enable row level security;
alter table public.referrals force row level security;

-- Either party reads it. Neither writes it: attribution and qualification are
-- earned through the definer functions below, never asserted by a client.
create policy referrals_select_party on public.referrals
  for select using (
    referrer_id = auth.uid() or referred_user_id = auth.uid()
  );
create policy referrals_insert_none on public.referrals
  for insert with check (false);
create policy referrals_update_none on public.referrals
  for update using (false) with check (false);
create policy referrals_delete_none on public.referrals
  for delete using (false);

alter table public.reward_entitlements enable row level security;
alter table public.reward_entitlements force row level security;

create policy reward_entitlements_select_own on public.reward_entitlements
  for select using (user_id = auth.uid());
create policy reward_entitlements_insert_none on public.reward_entitlements
  for insert with check (false);
create policy reward_entitlements_update_none on public.reward_entitlements
  for update using (false) with check (false);
create policy reward_entitlements_delete_none on public.reward_entitlements
  for delete using (false);

-- ---------------------------------------------------------------------------
-- attribute_referral
--
-- Called once, from the signup path, by the newly signed-in user.
--
-- Definer because the referred user must not be able to choose their own
-- referrer: codes are owner-scoped and unreadable to them, and a direct insert
-- would let anyone credit anybody. Everything the decision rests on is
-- established inside this function, from the caller's verified identity and
-- the stored programme rules.
--
-- `touched_at` arrives from the visitor's own cookie and is therefore
-- untrusted. It is clamped to `now()`, so a forged future timestamp buys no
-- extension of the window; an old one simply falls outside it.
--
-- Attribution model: last touch within the window. The cookie holds one value
-- and each resolution overwrites it, so "last touch" is a property of how the
-- touch is recorded rather than a tie-break applied here.
-- ---------------------------------------------------------------------------

create or replace function public.attribute_referral(
  candidate text,
  hashed_token text,
  touched_at timestamptz
)
returns table (outcome text, referral_state public.referral_state)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  invite public.referral_invitations%rowtype;
  code_row public.referral_codes%rowtype;
  program public.referral_programs%rowtype;
  referrer uuid;
  invitation uuid;
  resolved_code text;
  touch timestamptz;
begin
  if caller is null then
    return query select 'invalid'::text, null::public.referral_state;
    return;
  end if;

  -- Already attributed: report it rather than failing. A user who follows a
  -- second link should not see an error, and the first attribution stands.
  if exists (select 1 from public.referrals r where r.referred_user_id = caller) then
    return query
      select 'already_attributed'::text, r.state
        from public.referrals r where r.referred_user_id = caller;
    return;
  end if;

  -- An invitation token first: it identifies which invitation converted, and
  -- an invitation carries its own address to check self-referral against.
  select * into invite from public.referral_invitations i
   where i.token_hash = hashed_token
   limit 1;

  if found then
    if invite.state <> 'pending' or invite.expires_at < now() then
      return query select 'expired_invitation'::text, null::public.referral_state;
      return;
    end if;
    referrer := invite.user_id;
    invitation := invite.id;
    resolved_code := candidate;
    program := (select p from public.referral_programs p where p.key = invite.program_key);
  else
    select * into code_row from public.referral_codes c
     where c.code = upper(candidate)
     limit 1;

    if not found then
      return query select 'unknown_code'::text, null::public.referral_state;
      return;
    end if;

    referrer := code_row.user_id;
    invitation := null;
    resolved_code := code_row.code;
    program := (select p from public.referral_programs p where p.key = code_row.program_key);
  end if;

  if referrer = caller then
    return query select 'self_referral'::text, null::public.referral_state;
    return;
  end if;

  -- The same person under a second address is still the same person. Compared
  -- normalised, so a plus-tag or a gmail dot does not defeat it.
  select u.email into caller_email from auth.users u where u.id = caller;
  if exists (
    select 1 from auth.users u
     where u.id = referrer
       and public.normalise_email(u.email) = public.normalise_email(caller_email)
  ) then
    return query select 'self_referral'::text, null::public.referral_state;
    return;
  end if;

  touch := least(touched_at, now());
  if touch < now() - make_interval(days => program.attribution_window_days) then
    return query select 'outside_window'::text, null::public.referral_state;
    return;
  end if;

  -- The touch has to come *before* the account, or this is not a referral.
  --
  -- This is what makes it safe to attempt attribution at sign-in as well as at
  -- signup, which the engine has to do: on a project with email confirmation
  -- enabled there is no session at signup, so signup alone would never
  -- attribute anything. Attempting it at sign-in would otherwise credit a
  -- referrer whenever a long-standing user happened to click a friend's link.
  -- `created_at` is not a column the caller can forge.
  if exists (
    select 1 from auth.users u where u.id = caller and u.created_at < touch
  ) then
    return query select 'existing_account'::text, null::public.referral_state;
    return;
  end if;

  insert into public.referrals
    (program_key, referrer_id, referred_user_id, invitation_id, code, touched_at)
  values
    (program.key, referrer, caller, invitation, resolved_code, touch);

  if invitation is not null then
    update public.referral_invitations
       set state = 'accepted', accepted_by = caller, updated_at = now()
     where id = invitation;
  end if;

  return query select 'attributed'::text, 'joined'::public.referral_state;
exception
  -- The unique constraint is the real concurrency control. Two simultaneous
  -- attributions of the same user leave exactly one row; the loser reports the
  -- same thing it would have reported had it read first.
  when unique_violation then
    return query
      select 'already_attributed'::text, r.state
        from public.referrals r where r.referred_user_id = caller;
end;
$$;

revoke execute on function public.attribute_referral(text, text, timestamptz) from public;
grant execute on function public.attribute_referral(text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- evaluate_referral_qualification
--
-- Idempotent, and acts only for the caller's own referral.
--
-- The predicate is evaluated here, inside the definer function, against the
-- caller's real rows. That is the property that makes qualification earned
-- rather than claimed: there is no argument a client can pass to assert it.
--
-- The entitlement it mints belongs to the *referrer*, who is not the caller.
-- That is the second reason this cannot be a policy-guarded client write.
-- ---------------------------------------------------------------------------

create or replace function public.evaluate_referral_qualification()
returns table (outcome text, referral_state public.referral_state)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  ref public.referrals%rowtype;
  program public.referral_programs%rowtype;
  satisfied boolean;
begin
  if caller is null then
    return query select 'invalid'::text, null::public.referral_state;
    return;
  end if;

  select * into ref from public.referrals r where r.referred_user_id = caller;
  if not found then
    return query select 'no_referral'::text, null::public.referral_state;
    return;
  end if;

  if ref.state <> 'joined' then
    return query select 'already_settled'::text, ref.state;
    return;
  end if;

  select * into program from public.referral_programs p where p.key = ref.program_key;

  satisfied := case program.qualification_predicate
    when 'account_created' then true
    when 'first_trip_created' then exists (
      select 1 from public.trips t where t.user_id = caller
    )
    when 'first_trip_with_destination_and_dates' then exists (
      select 1 from public.trips t
       where t.user_id = caller
         and t.destination_country_key is not null
         and t.depart_on is not null
    )
    else false
  end;

  if not satisfied then
    return query select 'not_yet'::text, ref.state;
    return;
  end if;

  update public.referrals
     set state = 'qualified', qualified_at = now(), updated_at = now()
   where id = ref.id;

  insert into public.reward_entitlements
    (user_id, referral_id, program_key, reward_policy_key)
  values
    (ref.referrer_id, ref.id, program.key, program.reward_policy_key)
  on conflict (referral_id) do nothing;

  return query select 'qualified'::text, 'qualified'::public.referral_state;
end;
$$;

revoke execute on function public.evaluate_referral_qualification() from public;
grant execute on function public.evaluate_referral_qualification() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Migration 0003 established that a hosted Supabase project's default
-- privileges grant `anon` on every new public table, leaving RLS as the only
-- barrier. Same treatment here: anon holds nothing on any referral table,
-- including the programme rules — a signed-out visitor resolving a link needs
-- no database read at all, so there is no reason to leave the door ajar.
-- ---------------------------------------------------------------------------

revoke all on public.referral_programs     from anon;
revoke all on public.referral_codes        from anon;
revoke all on public.referral_invitations  from anon;
revoke all on public.referrals             from anon;
revoke all on public.reward_entitlements   from anon;

grant select on public.referral_programs                                  to authenticated;
grant select, insert, update, delete on public.referral_codes             to authenticated;
grant select, insert, update, delete on public.referral_invitations       to authenticated;
grant select on public.referrals                                          to authenticated;
grant select on public.reward_entitlements                                to authenticated;

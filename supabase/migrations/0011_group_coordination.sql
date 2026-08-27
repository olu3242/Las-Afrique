-- ---------------------------------------------------------------------------
-- Group coordination — Phase 2, Iteration 11.
--
-- Several people travelling the same journey coordinate around a shared plan
-- without any of them gaining access to another's private records.
--
-- The trust boundary, and why it is shaped this way
-- ------------------------------------------------
-- Every table from Iterations 1-10 is owner-scoped: `user_id = auth.uid()`,
-- all four verbs, `with check` alongside `using`. Two certified suites assert
-- the consequence directly — a second signed-in user gets nothing for another
-- user's trip, and a 404 for its URL.
--
-- Group coordination could have been built by relaxing those policies so that
-- members of a group can read each other's trips. That is not done here, and
-- deliberately: it would delete the property those suites certify. `trips`,
-- `travelers`, `document_records`, `cost_estimates`, `savings_plans` and
-- `vault_files` are untouched by this migration and stay owner-only.
--
-- Instead the group owns its own tables, and exactly four zones exist:
--
--   GROUP_SHARED                  travel_groups, group_tasks, group_activities,
--                                 group_dependencies — readable by any accepted
--                                 member of that group.
--
--   MEMBER_PRIVATE                every pre-existing tenant table, unchanged.
--                                 No group policy reaches them. Not even the
--                                 group owner.
--
--   MEMBER_SHARED_WITH_GROUP      columns a member fills in on their own
--                                 membership row — display name, their own
--                                 arrival and departure variation. Written by
--                                 the member, read by the group.
--
--   SYSTEM_DERIVED_GROUP_STATUS   a coarse state (ready / action_required /
--                                 blocked / …) derived from the member's own
--                                 records and published only when that member
--                                 has opted in. The underlying record never
--                                 crosses; only the word does.
--
-- A member links their private trip to the group through group_trips. That row
-- says "this person is travelling on this journey". It does not make the trip
-- readable to anyone else — group_trips carries no policy granting others a
-- read of `trips`, and none is added.
--
-- Money
-- -----
-- Coordination only. Activities carry an estimated cost and name who is
-- responsible for booking. There is no balance, no transfer, no pooled fund,
-- no escrow column anywhere in this migration, and none may be added to it.
--
-- Policy recursion
-- ----------------
-- "Readable by a member of the same group" is a predicate on
-- group_memberships that would have to query group_memberships, which
-- recurses. public.is_group_member() is security definer, so the lookup inside
-- it runs without RLS and the recursion is broken. It is the only privileged
-- construct here, it takes a group id and answers a boolean about the caller,
-- and it can leak nothing else.
-- ---------------------------------------------------------------------------

create type public.group_role as enum ('owner', 'coordinator', 'member');

create type public.group_member_state as enum ('active', 'left', 'removed');

create type public.group_invitation_state as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create type public.group_task_state as enum ('open', 'blocked', 'done');

create type public.group_participation_state as enum ('in', 'out', 'undecided');

-- ---------------------------------------------------------------------------
-- travel_groups
--
-- Owned by its creator. `owner_id` is the tenant key, so the group itself
-- obeys the same ownership rule as everything else; membership then widens
-- *read* access to the group's own rows and nothing further.
-- ---------------------------------------------------------------------------

create table public.travel_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  destination_country_key text references public.country_profiles (key),
  depart_on date,
  return_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The group's own dates must be coherent. Individual members vary from them
  -- on their membership row, not by corrupting the group's window.
  constraint travel_groups_dates_ordered
    check (depart_on is null or return_on is null or return_on >= depart_on)
);

create index travel_groups_owner_idx on public.travel_groups (owner_id);

-- ---------------------------------------------------------------------------
-- group_memberships
--
-- One row per person per group. Carries the member's own shared fields and
-- their choice about publishing derived status.
-- ---------------------------------------------------------------------------

create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.group_role not null default 'member',
  state public.group_member_state not null default 'active',

  -- MEMBER_SHARED_WITH_GROUP. The member writes these; the group reads them.
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 120),

  -- Member-specific variation on the shared plan. One person arriving a day
  -- later is a normal case, not an exception to model around.
  arrival_on date,
  departure_on date,

  -- The opt-in that governs SYSTEM_DERIVED_GROUP_STATUS. False by default:
  -- publishing a member's readiness to their group is a decision they make,
  -- not one made for them by joining.
  shares_readiness boolean not null default false,

  -- SYSTEM_DERIVED_GROUP_STATUS itself: one coarse word, derived by the member
  -- from their own records, inside their own policy. Never the blocker, never
  -- the document, never a date. Null means "nothing published" — which is also
  -- what an opt-out resets it to, so withdrawing consent stops the disclosure
  -- rather than freezing the last word in place.
  coordination_state text check (
    coordination_state is null or coordination_state in
      ('ready', 'action_required', 'blocked', 'optional', 'complete')
  ),

  -- Publishing a state while sharing is off would be a disclosure the member
  -- did not consent to. Refused outright rather than trusted to the writer.
  constraint group_memberships_state_needs_consent
    check (coordination_state is null or shares_readiness),

  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_memberships_unique_person unique (group_id, user_id),
  constraint group_memberships_dates_ordered
    check (arrival_on is null or departure_on is null or departure_on >= arrival_on)
);

create index group_memberships_group_idx on public.group_memberships (group_id);
create index group_memberships_user_idx on public.group_memberships (user_id);

-- Exactly one active owner per group, enforced rather than assumed.
create unique index group_memberships_single_owner
  on public.group_memberships (group_id)
  where role = 'owner' and state = 'active';

-- ---------------------------------------------------------------------------
-- is_group_member / group_role_of
--
-- Security definer so the membership lookup inside a membership policy does
-- not recurse. `search_path = ''` pins every name, so a schema earlier on a
-- caller's path cannot substitute a different table under a definer function.
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = gid
      and m.user_id = auth.uid()
      and m.state = 'active'
  );
$$;

create or replace function public.group_role_of(gid uuid)
returns public.group_role
language sql
security definer
stable
set search_path = ''
as $$
  select m.role from public.group_memberships m
  where m.group_id = gid
    and m.user_id = auth.uid()
    and m.state = 'active';
$$;

-- Coordinators and owners may shape the shared plan; members may not.
create or replace function public.can_coordinate(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = gid
      and m.user_id = auth.uid()
      and m.state = 'active'
      and m.role in ('owner', 'coordinator')
  );
$$;

revoke execute on function public.is_group_member(uuid) from public;
revoke execute on function public.group_role_of(uuid) from public;
revoke execute on function public.can_coordinate(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.group_role_of(uuid) to authenticated;
grant execute on function public.can_coordinate(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- group_invitations
--
-- The token is stored hashed. An invitation row readable by coordinators must
-- not hand them a working credential for someone else's acceptance.
-- ---------------------------------------------------------------------------

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.group_role not null default 'member',
  token_hash text not null,
  state public.group_invitation_state not null default 'pending',
  invited_by uuid not null references auth.users (id) on delete cascade,
  accepted_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An invitation cannot make someone the owner. Ownership transfer is a
  -- different operation with different consequences, and is not in this scope.
  constraint group_invitations_not_owner check (role <> 'owner'),

  -- Accepted means we know who accepted it.
  constraint group_invitations_accepted_has_actor
    check (state <> 'accepted' or accepted_by is not null)
);

-- Duplicate invitation handling, in the schema rather than in a race-prone
-- read-then-write: a second pending invite to the same address is refused.
create unique index group_invitations_one_pending_per_email
  on public.group_invitations (group_id, lower(email))
  where state = 'pending';

create index group_invitations_group_idx on public.group_invitations (group_id);
create index group_invitations_token_idx on public.group_invitations (token_hash);

-- ---------------------------------------------------------------------------
-- group_trips
--
-- A member's own trip, associated with the journey. Composite foreign key onto
-- (id, user_id) so a member cannot attach someone else's trip — the same
-- tenant-consistency rule migration 0006 established for trip children.
-- ---------------------------------------------------------------------------

create table public.group_trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  trip_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint group_trips_trip_fkey
    foreign key (trip_id, user_id) references public.trips (id, user_id)
    on delete cascade,

  -- One trip per person per group, and a trip belongs to one group.
  constraint group_trips_one_per_member unique (group_id, user_id),
  constraint group_trips_one_group_per_trip unique (trip_id)
);

create index group_trips_group_idx on public.group_trips (group_id);

-- ---------------------------------------------------------------------------
-- group_tasks and their assignments
-- ---------------------------------------------------------------------------

create table public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  detail text,
  due_on date,
  state public.group_task_state not null default 'open',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index group_tasks_group_idx on public.group_tasks (group_id);

create table public.group_task_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  task_id uuid not null references public.group_tasks (id) on delete cascade,
  assignee_id uuid not null references auth.users (id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now(),

  -- Assigning the same person the same task twice is the same fact stated
  -- twice. The constraint makes the mutation idempotent rather than the
  -- caller remembering to check.
  constraint group_task_assignments_unique unique (task_id, assignee_id)
);

create index group_task_assignments_group_idx
  on public.group_task_assignments (group_id);

-- ---------------------------------------------------------------------------
-- group_activities and participation
--
-- Cost here is an estimate and a statement of who books. Nothing is held,
-- transferred or settled.
-- ---------------------------------------------------------------------------

create table public.group_activities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  detail text,
  happens_on date,
  location text,
  estimated_cost numeric(12, 2) check (estimated_cost is null or estimated_cost >= 0),
  cost_currency text check (cost_currency is null or length(cost_currency) = 3),
  booking_owner_id uuid references auth.users (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A figure without its currency is not a figure anyone can act on.
  constraint group_activities_cost_has_currency
    check (estimated_cost is null or cost_currency is not null)
);

create index group_activities_group_idx on public.group_activities (group_id);

create table public.group_activity_participation (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  activity_id uuid not null references public.group_activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  state public.group_participation_state not null default 'undecided',
  updated_at timestamptz not null default now(),

  constraint group_activity_participation_unique unique (activity_id, user_id)
);

create index group_activity_participation_group_idx
  on public.group_activity_participation (group_id);

-- ---------------------------------------------------------------------------
-- group_dependencies
--
-- "The visa task cannot start until the passport task is done." Ordering
-- between tasks the group holds, not between private records.
-- ---------------------------------------------------------------------------

create table public.group_dependencies (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups (id) on delete cascade,
  task_id uuid not null references public.group_tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.group_tasks (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint group_dependencies_unique unique (task_id, depends_on_task_id),
  -- A task waiting on itself is a deadlock written down.
  constraint group_dependencies_not_self check (task_id <> depends_on_task_id)
);

create index group_dependencies_group_idx on public.group_dependencies (group_id);

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Read is membership-scoped. Write is role-scoped. Neither reaches a
-- pre-existing tenant table.
-- ---------------------------------------------------------------------------

alter table public.travel_groups enable row level security;
alter table public.travel_groups force row level security;

-- Members read the group; only the owner changes or deletes it.
create policy travel_groups_select_member on public.travel_groups
  for select using (owner_id = auth.uid() or public.is_group_member(id));
create policy travel_groups_insert_own on public.travel_groups
  for insert with check (owner_id = auth.uid());
create policy travel_groups_update_owner on public.travel_groups
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy travel_groups_delete_owner on public.travel_groups
  for delete using (owner_id = auth.uid());

alter table public.group_memberships enable row level security;
alter table public.group_memberships force row level security;

-- A member sees who else is in the group. That is the point of a group, and
-- it exposes only the membership row — never anything it points at.
create policy group_memberships_select_member on public.group_memberships
  for select using (user_id = auth.uid() or public.is_group_member(group_id));

-- Insert is the acceptance path and the group-creation path. A row may only
-- ever be created for yourself; invitations are validated in the action, and
-- the owner row is created by the group's creator.
create policy group_memberships_insert_self on public.group_memberships
  for insert with check (user_id = auth.uid());

-- A member edits their own row. A coordinator may change role and state for
-- others — that is what coordinating a group means — but the columns a member
-- owns are protected by a trigger below rather than by hoping nobody tries.
create policy group_memberships_update_self on public.group_memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy group_memberships_update_coordinator on public.group_memberships
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));

create policy group_memberships_delete_self on public.group_memberships
  for delete using (user_id = auth.uid());
create policy group_memberships_delete_coordinator on public.group_memberships
  for delete using (public.can_coordinate(group_id));

-- A coordinator may set another member's role and state. They may not rewrite
-- what that member chose to share — display name, their own dates, and above
-- all the readiness opt-in. Without this, "coordinator" would be a route to
-- publishing someone else's status on their behalf.
create or replace function public.guard_membership_shared_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No authenticated caller means the service role, a migration, or the table
  -- owner — all of which already bypass RLS by design, so guarding them here
  -- adds no protection and silently breaks legitimate administrative writes.
  -- The first version omitted this and reverted every such update to its old
  -- values, which the RLS suite caught by watching a seeded row refuse to
  -- change.
  if auth.uid() is null then
    return new;
  end if;

  -- The member editing their own row may set anything on it.
  if new.user_id = auth.uid() then
    return new;
  end if;

  new.display_name := old.display_name;
  new.arrival_on := old.arrival_on;
  new.departure_on := old.departure_on;
  new.shares_readiness := old.shares_readiness;
  -- The published word is the disclosure itself. A coordinator who could set
  -- it could publish a verdict about someone else's private records, which is
  -- the exact thing this whole design exists to prevent.
  new.coordination_state := old.coordination_state;
  return new;
end;
$$;

create trigger group_memberships_guard_shared
  before update on public.group_memberships
  for each row execute function public.guard_membership_shared_columns();

alter table public.group_invitations enable row level security;
alter table public.group_invitations force row level security;

-- Coordinators manage invitations. Acceptance is performed by a server action
-- that presents the token, so no policy grants an invitee a read here: seeing
-- pending invitations to a group you are not in would leak the guest list.
create policy group_invitations_select_coordinator on public.group_invitations
  for select using (public.can_coordinate(group_id));
create policy group_invitations_insert_coordinator on public.group_invitations
  for insert with check (public.can_coordinate(group_id) and invited_by = auth.uid());
create policy group_invitations_update_coordinator on public.group_invitations
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));
create policy group_invitations_delete_coordinator on public.group_invitations
  for delete using (public.can_coordinate(group_id));

alter table public.group_trips enable row level security;
alter table public.group_trips force row level security;

-- Members see that a person is travelling on this journey. The trip itself
-- stays behind the untouched `trips` policy.
create policy group_trips_select_member on public.group_trips
  for select using (user_id = auth.uid() or public.is_group_member(group_id));
create policy group_trips_insert_self on public.group_trips
  for insert with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy group_trips_update_self on public.group_trips
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy group_trips_delete_self on public.group_trips
  for delete using (user_id = auth.uid() or public.can_coordinate(group_id));

alter table public.group_tasks enable row level security;
alter table public.group_tasks force row level security;

create policy group_tasks_select_member on public.group_tasks
  for select using (public.is_group_member(group_id));
create policy group_tasks_insert_coordinator on public.group_tasks
  for insert with check (public.can_coordinate(group_id) and created_by = auth.uid());
create policy group_tasks_update_coordinator on public.group_tasks
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));
create policy group_tasks_delete_coordinator on public.group_tasks
  for delete using (public.can_coordinate(group_id));

alter table public.group_task_assignments enable row level security;
alter table public.group_task_assignments force row level security;

create policy group_task_assignments_select_member on public.group_task_assignments
  for select using (public.is_group_member(group_id));
create policy group_task_assignments_insert_coordinator
  on public.group_task_assignments
  for insert with check (public.can_coordinate(group_id));
-- An assignee marks their own work done; a coordinator may also close it.
create policy group_task_assignments_update_assignee
  on public.group_task_assignments
  for update using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());
create policy group_task_assignments_update_coordinator
  on public.group_task_assignments
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));
create policy group_task_assignments_delete_coordinator
  on public.group_task_assignments
  for delete using (public.can_coordinate(group_id));

alter table public.group_activities enable row level security;
alter table public.group_activities force row level security;

create policy group_activities_select_member on public.group_activities
  for select using (public.is_group_member(group_id));
create policy group_activities_insert_coordinator on public.group_activities
  for insert with check (public.can_coordinate(group_id) and created_by = auth.uid());
create policy group_activities_update_coordinator on public.group_activities
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));
create policy group_activities_delete_coordinator on public.group_activities
  for delete using (public.can_coordinate(group_id));

alter table public.group_activity_participation enable row level security;
alter table public.group_activity_participation force row level security;

-- Everyone sees who is coming. Only you decide whether you are.
create policy group_activity_participation_select_member
  on public.group_activity_participation
  for select using (public.is_group_member(group_id));
create policy group_activity_participation_insert_self
  on public.group_activity_participation
  for insert with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy group_activity_participation_update_self
  on public.group_activity_participation
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy group_activity_participation_delete_self
  on public.group_activity_participation
  for delete using (user_id = auth.uid() or public.can_coordinate(group_id));

alter table public.group_dependencies enable row level security;
alter table public.group_dependencies force row level security;

create policy group_dependencies_select_member on public.group_dependencies
  for select using (public.is_group_member(group_id));
create policy group_dependencies_insert_coordinator on public.group_dependencies
  for insert with check (public.can_coordinate(group_id));
create policy group_dependencies_update_coordinator on public.group_dependencies
  for update using (public.can_coordinate(group_id))
  with check (public.can_coordinate(group_id));
create policy group_dependencies_delete_coordinator on public.group_dependencies
  for delete using (public.can_coordinate(group_id));

-- ---------------------------------------------------------------------------
-- accept_group_invitation
--
-- The invitee cannot read group_invitations — no policy grants it, and none
-- should: a pending guest list is the group's business. That leaves them
-- unable to look up their own invitation, so acceptance goes through this
-- definer function instead of a select.
--
-- The token is the authorization. It arrives hashed, the row is found by that
-- hash, and a 256-bit token makes enumeration infeasible — which is why this
-- can be safely callable by any authenticated user.
--
-- Everything happens in one statement-scope: validate, join, close the
-- invitation. That is what makes double acceptance safe rather than a race —
-- the second call finds no pending row and reports already_member from the
-- membership that exists.
-- ---------------------------------------------------------------------------

create or replace function public.accept_group_invitation(hashed_token text)
returns table (outcome text, group_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.group_invitations%rowtype;
  caller uuid := auth.uid();
begin
  if caller is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select * into invite from public.group_invitations i
   where i.token_hash = hashed_token
   limit 1;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- Already a member: report it rather than failing. A double-clicked link
  -- should land the person in the group, not on an error page.
  if exists (
    select 1 from public.group_memberships m
     where m.group_id = invite.group_id and m.user_id = caller
  ) then
    return query select 'already_member'::text, invite.group_id;
    return;
  end if;

  if invite.state <> 'pending' or invite.expires_at < now() then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  insert into public.group_memberships (group_id, user_id, role)
  values (invite.group_id, caller, invite.role);

  update public.group_invitations
     set state = 'accepted', accepted_by = caller, updated_at = now()
   where id = invite.id;

  return query select 'joined'::text, invite.group_id;
end;
$$;

revoke execute on function public.accept_group_invitation(text) from public;
grant execute on function public.accept_group_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Migration 0003 established that Supabase's hosted default privileges grant
-- `anon` on new public tables, leaving RLS as the only barrier. Same treatment
-- here: anon holds nothing on any group table.
-- ---------------------------------------------------------------------------

revoke all on public.travel_groups                from anon;
revoke all on public.group_memberships           from anon;
revoke all on public.group_invitations           from anon;
revoke all on public.group_trips                 from anon;
revoke all on public.group_tasks                 from anon;
revoke all on public.group_task_assignments      from anon;
revoke all on public.group_activities            from anon;
revoke all on public.group_activity_participation from anon;
revoke all on public.group_dependencies          from anon;

-- A grant without a policy still returns nothing, and a policy without a grant
-- fails earlier with "permission denied" — both are required. Migration 0010
-- set this pattern; the local cluster has no Supabase default privileges to
-- fall back on, so omitting these made every group policy unreachable.
grant select, insert, update, delete on public.travel_groups                 to authenticated;
grant select, insert, update, delete on public.group_memberships             to authenticated;
grant select, insert, update, delete on public.group_invitations             to authenticated;
grant select, insert, update, delete on public.group_trips                   to authenticated;
grant select, insert, update, delete on public.group_tasks                   to authenticated;
grant select, insert, update, delete on public.group_task_assignments        to authenticated;
grant select, insert, update, delete on public.group_activities              to authenticated;
grant select, insert, update, delete on public.group_activity_participation  to authenticated;
grant select, insert, update, delete on public.group_dependencies            to authenticated;

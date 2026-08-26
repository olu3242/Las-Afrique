-- ---------------------------------------------------------------------------
-- Row-level security.
--
-- Posture: deny by default. RLS is enabled on every table, and a table without a
-- matching policy returns nothing and accepts nothing — including for the table
-- owner, via `force row level security`.
--
-- Tenant tables use a single predicate, `user_id = auth.uid()`, applied to all
-- four verbs. `with check` is specified separately from `using` so a user cannot
-- insert or re-assign a row into someone else's ownership.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- profiles — the user's own row, keyed by id rather than user_id
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_delete_own on public.profiles
  for delete using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- country_profiles — world-readable reference data
--
-- Readable by anyone, including signed-out visitors: entry requirements are not
-- a secret. No insert/update/delete policy exists, so writes are denied to every
-- role except the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.country_profiles enable row level security;

create policy country_profiles_select_all on public.country_profiles
  for select using (true);

-- ---------------------------------------------------------------------------
-- Tenant-scoped tables
-- ---------------------------------------------------------------------------

alter table public.trips enable row level security;
alter table public.trips force row level security;

create policy trips_select_own on public.trips
  for select using (user_id = auth.uid());
create policy trips_insert_own on public.trips
  for insert with check (user_id = auth.uid());
create policy trips_update_own on public.trips
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy trips_delete_own on public.trips
  for delete using (user_id = auth.uid());

alter table public.travelers enable row level security;
alter table public.travelers force row level security;

create policy travelers_select_own on public.travelers
  for select using (user_id = auth.uid());
create policy travelers_insert_own on public.travelers
  for insert with check (user_id = auth.uid());
create policy travelers_update_own on public.travelers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy travelers_delete_own on public.travelers
  for delete using (user_id = auth.uid());

alter table public.document_records enable row level security;
alter table public.document_records force row level security;

create policy document_records_select_own on public.document_records
  for select using (user_id = auth.uid());
create policy document_records_insert_own on public.document_records
  for insert with check (user_id = auth.uid());
create policy document_records_update_own on public.document_records
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy document_records_delete_own on public.document_records
  for delete using (user_id = auth.uid());

alter table public.cost_estimates enable row level security;
alter table public.cost_estimates force row level security;

create policy cost_estimates_select_own on public.cost_estimates
  for select using (user_id = auth.uid());
create policy cost_estimates_insert_own on public.cost_estimates
  for insert with check (user_id = auth.uid());
create policy cost_estimates_update_own on public.cost_estimates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cost_estimates_delete_own on public.cost_estimates
  for delete using (user_id = auth.uid());

alter table public.savings_plans enable row level security;
alter table public.savings_plans force row level security;

create policy savings_plans_select_own on public.savings_plans
  for select using (user_id = auth.uid());
create policy savings_plans_insert_own on public.savings_plans
  for insert with check (user_id = auth.uid());
create policy savings_plans_update_own on public.savings_plans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy savings_plans_delete_own on public.savings_plans
  for delete using (user_id = auth.uid());

alter table public.vault_files enable row level security;
alter table public.vault_files force row level security;

create policy vault_files_select_own on public.vault_files
  for select using (user_id = auth.uid());
create policy vault_files_insert_own on public.vault_files
  for insert with check (user_id = auth.uid());
create policy vault_files_update_own on public.vault_files
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy vault_files_delete_own on public.vault_files
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants
--
-- Grants decide which verbs a role may attempt; policies decide which rows it
-- reaches. Both are required — a grant without a policy still returns nothing.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.country_profiles to anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.trips,
  public.travelers,
  public.document_records,
  public.cost_estimates,
  public.savings_plans,
  public.vault_files
to authenticated;

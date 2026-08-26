-- ---------------------------------------------------------------------------
-- Make a child row's owner and its parent's owner the same, in the schema.
--
-- The hole this closes, found by probing the claim rather than trusting it:
--
--   Bob inserts into travelers with trip_id = <Alice's trip> and
--   user_id = <Bob>. The insert policy checks `user_id = auth.uid()` — true.
--   The foreign key checks the trip exists — true. The row is written.
--
-- Nothing leaks: Alice's traveller queries are scoped to her own user_id, so
-- she never sees it, and Bob still cannot read the trip. But Bob has written a
-- row into Alice's trip, and every later engine that walks trip_id (documents,
-- estimates, savings, vault files) inherits the same hole. It is a
-- cross-tenant integrity defect, and RLS as written does not stop it.
--
-- The fix is declarative rather than another policy predicate: a composite
-- foreign key onto (id, user_id) forces the child's owner to equal the
-- parent's. It holds for the service role and for any future code path too,
-- because it is a constraint rather than a rule someone has to remember to
-- apply.
--
-- MATCH SIMPLE (the default) means a null trip_id skips the check entirely,
-- which is what the nullable columns want.
-- ---------------------------------------------------------------------------

-- Referencable targets for the composite keys. `id` is already the primary key,
-- so these add a uniqueness guarantee Postgres requires, not a new restriction.
alter table public.trips
  add constraint trips_id_user_id_key unique (id, user_id);

alter table public.travelers
  add constraint travelers_id_user_id_key unique (id, user_id);

-- travelers.trip_id — the case that was actually exploitable.
alter table public.travelers
  drop constraint travelers_trip_id_fkey,
  add constraint travelers_trip_id_fkey
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade;

-- document_records references both a trip and, optionally, a traveller. Both
-- have to belong to the same user as the record.
alter table public.document_records
  drop constraint document_records_trip_id_fkey,
  add constraint document_records_trip_id_fkey
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade;

alter table public.document_records
  drop constraint document_records_traveler_id_fkey,
  add constraint document_records_traveler_id_fkey
    foreign key (traveler_id, user_id)
    references public.travelers (id, user_id)
    on delete cascade;

alter table public.cost_estimates
  drop constraint cost_estimates_trip_id_fkey,
  add constraint cost_estimates_trip_id_fkey
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade;

alter table public.savings_plans
  drop constraint savings_plans_trip_id_fkey,
  add constraint savings_plans_trip_id_fkey
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade;

-- vault_files.trip_id and traveler_id are both nullable: a file can be held
-- against the account rather than a specific trip. MATCH SIMPLE leaves those
-- rows unconstrained, and constrains the rest.
alter table public.vault_files
  drop constraint vault_files_trip_id_fkey,
  add constraint vault_files_trip_id_fkey
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade;

-- The original set this one to null rather than cascading, so a deleted
-- traveller left the file in place. Preserved.
alter table public.vault_files
  drop constraint vault_files_traveler_id_fkey,
  add constraint vault_files_traveler_id_fkey
    foreign key (traveler_id, user_id)
    references public.travelers (id, user_id)
    on delete set null;

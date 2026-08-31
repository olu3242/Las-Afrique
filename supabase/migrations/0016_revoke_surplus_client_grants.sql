-- ---------------------------------------------------------------------------
-- Remove surplus client privileges from the pre-Iteration-12 tables.
--
-- What this fixes
-- ---------------
-- A hosted Supabase project sets ALTER DEFAULT PRIVILEGES so every new table in
-- `public` is granted to `anon` and `authenticated` automatically. Migration
-- 0003 stripped `anon` from the tenant tables, and every migration since has
-- *added* the grants `authenticated` needs — but adding a grant does not remove
-- one. So on the real project `authenticated` still held the whole default set
-- on every table created before Iteration 12:
--
--   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- The engine needs four of those. Three are surplus, and one of the three
-- matters more than it looks:
--
--   TRUNCATE    Row-level security does not apply to TRUNCATE at all. It is the
--               one verb no policy can contain, so a surplus grant of it is the
--               only one where the grant layer is the *only* layer.
--   REFERENCES  The privilege to create a foreign key referencing the table.
--   TRIGGER     The privilege to create a trigger on the table.
--
-- The last two are DDL. Nothing in this application issues DDL as a client
-- role; migrations run as the table owner.
--
-- Iteration 12's own tables are already correct — 0013 and 0015 revoke before
-- they grant — so they are untouched here.
--
-- What was checked before revoking anything
-- -----------------------------------------
-- The privilege state was read off a database built *with* those default
-- privileges, rather than reasoned about, and each candidate was traced to a
-- caller before being removed:
--
--   * No module imports `lib/supabase/client.ts`, so nothing runs as `anon`
--     through the API at all.
--   * No application code issues DDL. The only `truncate` matches in the
--     codebase are Tailwind classes in JSX.
--   * PostgREST's embedded reads — `select("*, country_profiles(name),
--     travelers(id)")` in `lib/trips/service.ts` — were run as a signed-in user
--     with REFERENCES, TRIGGER and TRUNCATE revoked, and still resolve. Reading
--     across a foreign key needs SELECT on both tables; REFERENCES is the
--     privilege to *create* such a constraint, which is a different thing and
--     is easy to confuse for a required one.
--
-- Why revoke-all-then-grant rather than naming the three
-- -----------------------------------------------------
-- `revoke truncate, references, trigger` would express the intent exactly, and
-- would silently miss anything a different PostgreSQL version adds to `GRANT
-- ALL` — PostgreSQL 17 adds MAINTAIN, and naming a privilege that does not
-- exist on the running version is a syntax error rather than a no-op. Revoking
-- everything and re-granting exactly what the engine uses gives the same end
-- state on any version.
--
-- `anon` is deliberately absent from every statement below. It holds SELECT on
-- the two reference tables and nothing else, which is intended and is asserted
-- by the schema tests; touching it here could only take away something that is
-- meant to be there.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tenant tables — owner-scoped, and genuinely written by their owner.
-- ---------------------------------------------------------------------------

revoke all on public.profiles          from authenticated;
revoke all on public.trips             from authenticated;
revoke all on public.travelers         from authenticated;
revoke all on public.document_records  from authenticated;
revoke all on public.cost_estimates    from authenticated;
revoke all on public.savings_plans     from authenticated;
revoke all on public.vault_files       from authenticated;
revoke all on public.reminders         from authenticated;

grant select, insert, update, delete on public.profiles          to authenticated;
grant select, insert, update, delete on public.trips             to authenticated;
grant select, insert, update, delete on public.travelers         to authenticated;
grant select, insert, update, delete on public.document_records  to authenticated;
grant select, insert, update, delete on public.cost_estimates    to authenticated;
grant select, insert, update, delete on public.savings_plans     to authenticated;
grant select, insert, update, delete on public.vault_files       to authenticated;
grant select, insert, update, delete on public.reminders         to authenticated;

-- ---------------------------------------------------------------------------
-- Group coordination — membership-scoped reads, role-scoped writes. Both still
-- need all four verbs; the policies decide who may use them, as before.
-- ---------------------------------------------------------------------------

revoke all on public.travel_groups                from authenticated;
revoke all on public.group_memberships            from authenticated;
revoke all on public.group_invitations            from authenticated;
revoke all on public.group_trips                  from authenticated;
revoke all on public.group_tasks                  from authenticated;
revoke all on public.group_task_assignments       from authenticated;
revoke all on public.group_activities             from authenticated;
revoke all on public.group_activity_participation from authenticated;
revoke all on public.group_dependencies           from authenticated;

grant select, insert, update, delete on public.travel_groups                to authenticated;
grant select, insert, update, delete on public.group_memberships            to authenticated;
grant select, insert, update, delete on public.group_invitations            to authenticated;
grant select, insert, update, delete on public.group_trips                  to authenticated;
grant select, insert, update, delete on public.group_tasks                  to authenticated;
grant select, insert, update, delete on public.group_task_assignments       to authenticated;
grant select, insert, update, delete on public.group_activities             to authenticated;
grant select, insert, update, delete on public.group_activity_participation to authenticated;
grant select, insert, update, delete on public.group_dependencies           to authenticated;

-- ---------------------------------------------------------------------------
-- Reference data — read-only to every client, as it already was in policy.
-- `country_profiles` was carrying REFERENCES and TRIGGER; `cost_assumptions`
-- was already clean and is restated so the end state does not depend on which
-- migration happened to create it.
-- ---------------------------------------------------------------------------

revoke all on public.country_profiles from authenticated;
revoke all on public.cost_assumptions from authenticated;

grant select on public.country_profiles to authenticated;
grant select on public.cost_assumptions to authenticated;

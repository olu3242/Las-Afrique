-- ---------------------------------------------------------------------------
-- Provision a profile row when an auth user is created.
--
-- Iteration 2's path is `signup → profile → trip intake → …`. The profile step
-- has to be real, and it has to hold for every route into the system — a user
-- created by the Auth admin API or by an OAuth callback has no application
-- code between signup and the first authenticated request, so a "create the
-- profile in the sign-up action" approach leaves those users without one.
--
-- Doing it in a trigger on auth.users makes the profile a property of the user
-- existing, not of the path they took to exist.
--
-- `security definer` is required: the inserting role during signup is GoTrue's,
-- which has no rights on public.profiles, and the row is created before any
-- session exists so auth.uid() is null and the RLS policy could not match. The
-- function is therefore pinned to an empty search_path and writes exactly one
-- row to one table — it takes no input from the caller beyond the new user's
-- own id and metadata.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Supabase puts whatever the client passed as sign-up metadata here. It is
    -- user-supplied text, stored as a display name and nothing else; it is
    -- never used to make an authorization decision.
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Not `create or replace` — triggers have no replace form, and re-running a
-- migration is not a thing that happens. Dropped first so the definition is
-- unambiguous if it ever is.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users who signed up before this migration. Without it, an existing
-- account would sign in to a dashboard that cannot find its own profile.
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

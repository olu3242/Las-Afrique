-- ---------------------------------------------------------------------------
-- The document vault's storage bucket and its access rules.
--
-- vault_files already exists (0001) and holds metadata only — the bytes live
-- in object storage. This creates the bucket and the policies that make a
-- traveller's documents reachable by them and by nobody else.
--
-- The path convention is load-bearing, not cosmetic. Every object lives under
-- <user_id>/..., and every policy compares the first path segment to
-- auth.uid(). That makes ownership a property of where the object is, which
-- storage can enforce, rather than a property of a metadata row someone has
-- to remember to join against.
--
-- Private bucket: a passport scan must never be reachable by URL alone.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vault',
  'vault',
  false,
  -- 15 MB. A phone photo of a passport page is well under this; anything far
  -- above it is not a travel document.
  15728640,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies. All four verbs, each comparing the object's owning folder to the
-- caller, with `with check` alongside `using` so an object cannot be written
-- into, or moved into, another user's folder.
-- ---------------------------------------------------------------------------

drop policy if exists vault_select_own on storage.objects;
create policy vault_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists vault_insert_own on storage.objects;
create policy vault_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists vault_update_own on storage.objects;
create policy vault_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists vault_delete_own on storage.objects;
create policy vault_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Metadata integrity.
--
-- storage_path is already unique (0001). This adds the rule that makes the
-- storage policies and the metadata agree: a vault_files row must point at a
-- path inside its own owner's folder. Without it a row could claim a path it
-- has no rights to, and reconciliation would report a file the user cannot
-- actually reach.
-- ---------------------------------------------------------------------------

alter table public.vault_files
  add constraint vault_files_path_under_owner
  check (storage_path like user_id::text || '/%');

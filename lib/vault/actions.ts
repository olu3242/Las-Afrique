"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { field, type ActionState } from "@/lib/forms";
import {
  VAULT_BUCKET,
  storagePathFor,
  validateUpload,
} from "./service";

export type VaultField = "file" | "label";

/**
 * Uploads a document, then records it.
 *
 * Order matters: the object is written first and the metadata second. If the
 * metadata write fails, the object is removed again rather than left behind —
 * an orphaned object is invisible to the traveller, and invisible files
 * containing passport scans are worse than a failed upload they can retry.
 *
 * The reverse order would be worse still: a row pointing at nothing looks like
 * a document the user has, and they would find out otherwise at a border.
 */
export async function uploadDocument(
  _previous: ActionState<VaultField>,
  form: FormData,
): Promise<ActionState<VaultField>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=required");

  const tripId = field(form, "tripId");
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", errors: { file: "Choose a file to upload." } };
  }

  const problem = validateUpload(file.name, file.type, file.size);
  if (problem) return { status: "error", errors: { file: problem } };

  // The user id comes from the verified session, never from the form — it is
  // the segment the storage policy checks.
  const path = storagePathFor(user.id, tripId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return {
      status: "error",
      message: "We could not upload that file. Try again.",
    };
  }

  const { error: metadataError } = await supabase.from("vault_files").insert({
    user_id: user.id,
    trip_id: tripId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    byte_size: file.size,
  });

  if (metadataError) {
    // Roll the object back. See above.
    await supabase.storage.from(VAULT_BUCKET).remove([path]);
    return {
      status: "error",
      message: "We uploaded the file but could not record it, so we removed it. Try again.",
    };
  }

  if (tripId) revalidatePath(`/trips/${tripId}`);
  revalidatePath("/vault");
  return { status: "idle" };
}

/**
 * Removes a document.
 *
 * Object first again, for the same reason: a row with no object is a document
 * the traveller thinks they have.
 */
export async function deleteDocument(form: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=required");

  const id = field(form, "fileId");
  const tripId = field(form, "tripId");
  if (!id) return;

  // Read the path back under RLS, so another user's id resolves to nothing
  // rather than to a path this code would then delete.
  const { data } = await supabase
    .from("vault_files")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!data) return;

  await supabase.storage.from(VAULT_BUCKET).remove([data.storage_path]);
  await supabase.from("vault_files").delete().eq("id", id);

  if (tripId) revalidatePath(`/trips/${tripId}`);
  revalidatePath("/vault");
}

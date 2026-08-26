import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { VaultFileRow } from "@/lib/supabase/types";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from "./constants";

/**
 * The document vault.
 *
 * Metadata lives in `vault_files`, bytes in the `vault` bucket. Ownership is a
 * property of the object's path — everything sits under `<user_id>/…` and the
 * storage policies compare that first segment to `auth.uid()`. That means a
 * file cannot be reached by someone else even if a metadata row went missing
 * or pointed somewhere wrong.
 *
 * Nothing here mints a public URL. The bucket is private and downloads go
 * through short-lived signed URLs, because a passport scan reachable by URL
 * alone is a passport scan that will eventually be shared by accident.
 */

export const VAULT_BUCKET = "vault";

// Re-exported from constants.ts, which the browser can import — this module
// cannot, since it is server-only.
export { MAX_FILE_BYTES, ALLOWED_MIME_TYPES } from "./constants";

export interface VaultFile extends VaultFileRow {
  /** Short-lived. Null when a URL could not be signed. */
  downloadUrl: string | null;
}

/** How long a download link lives. Long enough to click, short enough to leak safely. */
const SIGNED_URL_TTL_SECONDS = 60;

export function validateUpload(
  fileName: string,
  mimeType: string,
  byteSize: number,
): string | null {
  if (!fileName.trim()) return "That file has no name.";
  if (byteSize <= 0) return "That file is empty.";
  if (byteSize > MAX_FILE_BYTES) {
    return `Files must be under ${Math.floor(MAX_FILE_BYTES / 1_048_576)} MB.`;
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
    return "Upload a PDF or a photo of the document.";
  }
  return null;
}

/**
 * Where an object lives.
 *
 * The user id first, always — that segment is what the storage policy checks,
 * so the path is the authorization rather than a label attached to it. The
 * random suffix stops two uploads of "passport.pdf" colliding.
 */
export function storagePathFor(
  userId: string,
  tripId: string | null,
  fileName: string,
): string {
  const safe = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // Collapse dot runs. A slash-free name cannot traverse anywhere, so this
    // is not load-bearing for safety — but a stored filename reading
    // ".._.._etc_passwd" is a thing someone will later mistake for an attack
    // that worked.
    .replace(/\.{2,}/g, ".")
    .slice(0, 80);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return [userId, tripId ?? "account", `${unique}-${safe}`].join("/");
}

export async function listVaultFiles(tripId: string | null): Promise<VaultFile[]> {
  const supabase = await createClient();

  let query = supabase.from("vault_files").select("*");
  // RLS scopes to the caller either way; the trip filter is about relevance.
  if (tripId) query = query.eq("trip_id", tripId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load your documents: ${error.message}`);

  const rows = (data ?? []) as VaultFileRow[];

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      downloadUrl: await signDownload(row.storage_path),
    })),
  );
}

async function signDownload(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  // A file whose link cannot be signed is still listed — the row is real and
  // the traveller should know it exists. It just has no working link.
  return error ? null : (data?.signedUrl ?? null);
}

export interface Reconciliation {
  /** Metadata rows with no object behind them. */
  orphanedRows: VaultFileRow[];
  /** Objects in storage with no metadata row. */
  orphanedObjects: string[];
}

/**
 * Compares what the metadata claims against what storage holds.
 *
 * Two writes cannot be made atomic across a table and an object store, so they
 * will drift: an upload that succeeded then failed to record itself, a delete
 * that removed the row and not the file. Rather than pretending otherwise,
 * this reports the drift so it can be resolved.
 */
export async function reconcile(userId: string): Promise<Reconciliation> {
  const supabase = await createClient();

  const { data: rows } = await supabase.from("vault_files").select("*");
  const metadata = (rows ?? []) as VaultFileRow[];

  const { data: objects } = await supabase.storage
    .from(VAULT_BUCKET)
    .list(userId, { limit: 1000 });

  // Storage lists one folder at a time; paths are rebuilt to compare like
  // with like.
  const objectPaths = new Set(
    (objects ?? []).map((object) => `${userId}/${object.name}`),
  );
  const metadataPaths = new Set(metadata.map((row) => row.storage_path));

  return {
    orphanedRows: metadata.filter((row) => !objectPaths.has(row.storage_path)),
    orphanedObjects: [...objectPaths].filter((path) => !metadataPaths.has(path)),
  };
}

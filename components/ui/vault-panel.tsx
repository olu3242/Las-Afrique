import type { VaultFile } from "@/lib/vault/service";
import { deleteDocument } from "@/lib/vault/actions";
import { UploadForm } from "./vault-upload-form";

function size(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * The document vault.
 *
 * Download links are signed and short-lived rather than public, so a link that
 * leaks stops working. A file whose link could not be signed is still listed —
 * the row is real and the traveller should know the document exists — it just
 * says so instead of offering a broken link.
 */
export function VaultPanel({
  files,
  tripId,
}: {
  files: VaultFile[];
  tripId: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-relaxed text-muted">
        Stored privately and reachable only by you. Links expire shortly after
        they are created, so a shared link stops working.
      </p>

      {files.length === 0 ? (
        <p className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
          No documents yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-base text-ivory">{file.file_name}</p>
                <p className="mt-1 text-data text-sm text-muted">
                  {size(file.byte_size)}
                  {file.mime_type ? ` · ${file.mime_type}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {file.downloadUrl ? (
                  <a
                    href={file.downloadUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                  >
                    Open
                    <span className="sr-only"> {file.file_name}</span>
                  </a>
                ) : (
                  <span className="text-sm text-muted">Link unavailable</span>
                )}

                <form action={deleteDocument}>
                  <input type="hidden" name="fileId" value={file.id} />
                  {tripId ? (
                    <input type="hidden" name="tripId" value={tripId} />
                  ) : null}
                  <button
                    type="submit"
                    className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                  >
                    Delete
                    <span className="sr-only"> {file.file_name}</span>
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadForm tripId={tripId} />
    </div>
  );
}

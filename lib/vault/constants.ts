/**
 * Vault limits shared by the server and the browser.
 *
 * Split out of `service.ts` because that module imports `server-only`: the
 * upload form needs the accepted types to populate its file picker, and a
 * client component importing the service would fail the build — correctly.
 */
export const MAX_FILE_BYTES = 15_728_640;

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
] as const;

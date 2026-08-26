import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  storagePathFor,
  validateUpload,
} from "@/lib/vault/service";

describe("vault upload validation", () => {
  it("accepts a passport photo", () => {
    expect(validateUpload("passport.jpg", "image/jpeg", 2_000_000)).toBeNull();
  });

  it("accepts a PDF", () => {
    expect(validateUpload("visa.pdf", "application/pdf", 500_000)).toBeNull();
  });

  it.each([
    ["application/zip", "an archive"],
    ["text/html", "a web page"],
    ["application/x-msdownload", "an executable"],
  ])("refuses %s (%s)", (mime) => {
    expect(validateUpload("thing", mime, 1000)).toMatch(/PDF or a photo/i);
  });

  it("refuses a file over the bucket's own limit", () => {
    // Refused here so the user hears it before the upload, not after.
    expect(
      validateUpload("huge.pdf", "application/pdf", MAX_FILE_BYTES + 1),
    ).toMatch(/under 15 MB/i);
  });

  it("accepts a file exactly at the limit", () => {
    expect(
      validateUpload("edge.pdf", "application/pdf", MAX_FILE_BYTES),
    ).toBeNull();
  });

  it.each([
    ["", 1000, /no name/i],
    ["empty.pdf", 0, /empty/i],
  ])("refuses %s at %s bytes", (name, size, pattern) => {
    expect(validateUpload(name, "application/pdf", size)).toMatch(pattern);
  });
});

describe("vault storage paths", () => {
  const USER = "11111111-1111-1111-1111-111111111111";

  it("puts the owner first, because that segment is the authorization", () => {
    // The storage policy compares (foldername(name))[1] to auth.uid(), so a
    // path that did not lead with the user id would not be reachable by its
    // own owner — and worse, might be reachable by someone else.
    const path = storagePathFor(USER, "trip-1", "passport.pdf");
    expect(path.split("/")[0]).toBe(USER);
  });

  it("files an account-level document under a stable folder", () => {
    expect(storagePathFor(USER, null, "passport.pdf").split("/")[1]).toBe(
      "account",
    );
  });

  it("strips characters that would change the path's shape", () => {
    // The one that matters: a filename containing a slash would otherwise
    // invent a folder level, and the first segment is the authorization.
    const path = storagePathFor(USER, "trip-1", "../../etc/passwd");
    expect(path.split("/")).toHaveLength(3);
    expect(path.startsWith(`${USER}/trip-1/`)).toBe(true);
    // Not load-bearing — a slash-free name traverses nowhere — but a stored
    // filename reading ".._.._etc_passwd" invites a later reader to think an
    // attack got through.
    expect(path).not.toContain("..");
  });

  it("keeps two uploads of the same name apart", () => {
    const a = storagePathFor(USER, "trip-1", "passport.pdf");
    const b = storagePathFor(USER, "trip-1", "passport.pdf");
    expect(a).not.toBe(b);
  });

  it("keeps the original name legible in the path", () => {
    expect(storagePathFor(USER, "trip-1", "passport.pdf")).toMatch(
      /passport\.pdf$/,
    );
  });

  it("truncates a very long name rather than rejecting it", () => {
    const path = storagePathFor(USER, "trip-1", `${"a".repeat(300)}.pdf`);
    expect(path.split("/")[2].length).toBeLessThan(120);
  });
});

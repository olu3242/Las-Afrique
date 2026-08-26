import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { apiConfig, databaseUrl, sslConfig } from "./connection";
import { createConfirmedUser, rest, serviceRoleKey, type Session } from "./users";
import {
  expectVaultBucket,
  expectVaultStoragePolicies,
} from "../support/schema-queries";

/**
 * The vault's storage half, against the real project.
 *
 * Everything else about Iteration 8 was already certified: `vault_files`
 * through PostgREST, its RLS, and the constraint tying a row's path to its
 * owner. None of that touches object storage, so a missing bucket, a policy
 * that never applied, or a bucket left public would all have gone undetected
 * while the iteration read PASS. A review caught the overstatement; this is the
 * evidence it was missing.
 *
 * Storage authorization here is a property of the object's *path* — every
 * object lives under `<user_id>/…` and each policy in migration 0009 compares
 * that first segment to `auth.uid()`. So these probes are written against paths
 * rather than against metadata rows: the interesting failure is an object
 * reachable by the wrong person, which no amount of correct metadata prevents.
 */

const { supabaseUrl, publishableKey } = apiConfig();

const BUCKET = "vault";

/** A tiny but genuine PDF. Real bytes matter — the bucket filters MIME types. */
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

function storageUrl(path: string): string {
  return `${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`;
}

async function upload(
  session: Session,
  path: string,
  bytes: Buffer = PDF_BYTES,
): Promise<Response> {
  return fetch(storageUrl(path), {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: new Uint8Array(bytes),
  });
}

async function download(session: Session | null, path: string): Promise<Response> {
  return fetch(storageUrl(path), {
    headers: session
      ? {
          apikey: publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        }
      : { apikey: publishableKey },
  });
}

async function signUrl(session: Session, path: string): Promise<Response> {
  return fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });
}

async function remove(session: Session, path: string): Promise<Response> {
  return fetch(storageUrl(path), {
    method: "DELETE",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });
}

describe("hosted vault storage", () => {
  let db: Client;
  let alice: Session;
  let bob: Session;
  let alicePath: string;

  beforeAll(async () => {
    const adminKey = await serviceRoleKey();
    alice = await createConfirmedUser(adminKey);
    bob = await createConfirmedUser(adminKey);

    const url = databaseUrl();
    db = new Client({ connectionString: url, ssl: sslConfig(url) });
    await db.connect();

    // Mirrors storagePathFor(): owner segment first, then the trip, then a
    // collision-proof file name.
    alicePath = `${alice.userId}/account/${Date.now()}-passport.pdf`;
  });

  afterAll(async () => {
    if (!db) return;
    // Objects first — deleting the user does not cascade into storage, and a
    // probe that leaves passport-shaped files in the bucket is a probe that
    // slowly fills it.
    for (const who of [alice, bob]) {
      if (!who) continue;
      await db.query(
        `delete from storage.objects
          where bucket_id = $1 and (storage.foldername(name))[1] = $2`,
        [BUCKET, who.userId],
      );
    }
    await db.query(`delete from auth.users where email = any($1)`, [
      [alice?.email, bob?.email].filter(Boolean),
    ]);
    await db.end();
  });

  // --- the bucket itself ---------------------------------------------------

  it("has the vault bucket, private and MIME-restricted", async () => {
    // The same assertion the local tier runs. There it proves migration 0009
    // is correct; here it proves the project actually has it.
    await expectVaultBucket(db);
  });

  it("carries a policy for all four verbs on the bucket", async () => {
    await expectVaultStoragePolicies(db);
  });

  // --- the owner's own path ------------------------------------------------

  it("stores an object under the owner's folder and reads the bytes back", async () => {
    const uploaded = await upload(alice, alicePath);
    expect(uploaded.status, await uploaded.clone().text()).toBeLessThan(300);

    const read = await download(alice, alicePath);
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("records metadata that survives a fresh read", async () => {
    const created = await rest("vault_files", alice.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: alice.userId,
        storage_path: alicePath,
        file_name: "passport.pdf",
        mime_type: "application/pdf",
        byte_size: PDF_BYTES.byteLength,
      }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    // A separate request, not the insert's own response — this is the
    // read-back the page performs on refresh.
    const listed = await rest(
      `vault_files?select=storage_path,file_name,byte_size` +
        `&storage_path=eq.${encodeURIComponent(alicePath)}`,
      alice.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      {
        storage_path: alicePath,
        file_name: "passport.pdf",
        byte_size: PDF_BYTES.byteLength,
      },
    ]);
  });

  it("serves the bytes through a signed URL", async () => {
    const signed = await signUrl(alice, alicePath);
    expect(signed.status, await signed.clone().text()).toBe(200);

    const { signedURL } = (await signed.json()) as { signedURL: string };
    expect(signedURL).toBeTruthy();

    // Followed with no Authorization header at all: the signature is the
    // authorization, which is what makes the link usable from an <a href>.
    const followed = await fetch(`${supabaseUrl}/storage/v1${signedURL}`);
    expect(followed.status).toBe(200);
    expect(Buffer.from(await followed.arrayBuffer())).toEqual(PDF_BYTES);
  });

  // --- everyone else -------------------------------------------------------

  it("refuses an unauthenticated read of a stored object", async () => {
    const anonymous = await download(null, alicePath);
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses another signed-in user the bytes", async () => {
    const theft = await download(bob, alicePath);
    expect(theft.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses another user a signed URL for it", async () => {
    // Worth its own probe: signing is a separate endpoint from reading, and a
    // policy gap here would hand out a link that then works for anyone.
    const signed = await signUrl(bob, alicePath);
    expect(signed.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses another user a write into the owner's folder", async () => {
    const intruder = `${alice.userId}/account/${Date.now()}-planted.pdf`;
    const planted = await upload(bob, intruder);
    expect(planted.status).toBeGreaterThanOrEqual(400);

    // And nothing landed. A 4xx with the object written would be the worst
    // outcome of the three, so the response code is not taken on trust.
    const { rows } = await db.query(
      `select 1 from storage.objects where bucket_id = $1 and name = $2`,
      [BUCKET, intruder],
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses another user the delete, and the object survives it", async () => {
    const attempt = await remove(bob, alicePath);
    expect(attempt.status).toBeGreaterThanOrEqual(400);

    const stillThere = await download(alice, alicePath);
    expect(stillThere.status).toBe(200);
  });

  // --- metadata cannot outrun the policies ---------------------------------

  it("refuses a metadata row pointing outside its owner's folder", async () => {
    // The constraint from 0009. Without it a row could name someone else's
    // path — the bytes would stay unreachable, but the vault would list a
    // document the user does not actually have, which they would discover at
    // a border.
    const forged = await rest("vault_files", bob.accessToken, {
      method: "POST",
      body: JSON.stringify({
        user_id: bob.userId,
        storage_path: alicePath,
        file_name: "not-mine.pdf",
        mime_type: "application/pdf",
        byte_size: PDF_BYTES.byteLength,
      }),
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });

  it("shows the owner's document to nobody else through the metadata API", async () => {
    const theirs = await rest("vault_files?select=storage_path", bob.accessToken);
    expect(theirs.status).toBe(200);
    expect(await theirs.json()).toEqual([]);
  });

  // --- and the owner can remove it ----------------------------------------

  it("lets the owner delete the object and the row", async () => {
    const deleted = await remove(alice, alicePath);
    expect(deleted.status, await deleted.clone().text()).toBeLessThan(300);

    const gone = await download(alice, alicePath);
    expect(gone.status).toBeGreaterThanOrEqual(400);

    const rowDeleted = await rest(
      `vault_files?storage_path=eq.${encodeURIComponent(alicePath)}`,
      alice.accessToken,
      { method: "DELETE" },
    );
    expect(rowDeleted.status).toBeLessThan(300);

    const listed = await rest(
      `vault_files?select=storage_path&storage_path=eq.${encodeURIComponent(alicePath)}`,
      alice.accessToken,
    );
    expect(await listed.json()).toEqual([]);
  });
});

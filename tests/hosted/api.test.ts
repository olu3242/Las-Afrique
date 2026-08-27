import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { apiConfig, databaseUrl } from "./connection";
import {
  createConfirmedUser,
  rest,
  serviceRoleKey,
  type Session,
} from "./users";

/**
 * The hosted HTTP path: Auth issues a session, PostgREST enforces RLS on it.
 *
 * This is the half the direct-SQL suite cannot reach — it proves the project's
 * API layer applies the policies, not merely that the policies exist.
 *
 * Two project settings gate it, and both are reported explicitly rather than
 * worked around:
 *
 *   Email confirmation must be off. With it on, signup succeeds but returns no
 *   session, and every signup sends a mail — which is how a run ends in
 *   over_email_send_rate_limit rather than anything to do with this code.
 *
 *   The probe domain must be one the project accepts. Supabase rejects
 *   example.com and the reserved .invalid/.test TLDs outright, so
 *   HOSTED_PROBE_EMAIL_DOMAIN overrides the default.
 */
const { supabaseUrl, publishableKey } = apiConfig();

describe("hosted API — anonymous", () => {
  it("serves country reference data", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/country_profiles?select=key`, {
      headers: { apikey: publishableKey },
    });
    expect(response.status).toBe(200);
  });

  it("exposes no tenant rows", async () => {
    // Asserts the security property, not the mechanism. Denial may land at the
    // grant layer or at RLS; migration 0003 makes it the former. The empty-array
    // branch stays accepted so this cannot pass while rows leak.
    for (const table of ["trips", "travelers", "profiles", "vault_files"]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*`, {
        headers: { apikey: publishableKey },
      });

      if (response.status < 400) {
        expect(await response.json(), `${table} must expose no rows`).toEqual([]);
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("refuses writes to reference data", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/country_profiles`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "atlantis",
        name: "Atlantis",
        currency: "XXX",
        sort_order: 999,
      }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("hosted API — two signed-in users", () => {
  let db: Client;
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    const adminKey = await serviceRoleKey();
    alice = await createConfirmedUser(adminKey);
    bob = await createConfirmedUser(adminKey);

    db = new Client({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
  });

  afterAll(async () => {
    if (!db) return;
    // Cascades clear the trips these users created.
    await db.query(`delete from auth.users where email = any($1)`, [
      [alice?.email, bob?.email].filter(Boolean),
    ]);
    await db.end();
  });

  it("issues a session that survives a follow-up request", async () => {
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${alice.accessToken}`,
      },
    });
    expect(who.status).toBe(200);
    expect((await who.json()).id).toBe(alice.userId);
  });

  it("isolates one user's trip from another through PostgREST", async () => {
    const created = await rest("trips", alice.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: alice.userId, destination_city: "Lagos" }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    const own = await rest("trips?select=id,destination_city", alice.accessToken);
    expect(own.status).toBe(200);
    expect(await own.json()).toHaveLength(1);

    const other = await rest("trips?select=id", bob.accessToken);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual([]);
  });

  it("refuses a forged insert owned by another user", async () => {
    const forged = await rest("trips", bob.accessToken, {
      method: "POST",
      body: JSON.stringify({ user_id: alice.userId, destination_city: "Forged" }),
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { apiConfig } from "./connection";

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

const PROBE_DOMAIN = process.env.HOSTED_PROBE_EMAIL_DOMAIN ?? "takemehome-probe.dev";

interface Session {
  accessToken: string;
  userId: string;
}

/** Signs up once. Every failure mode is named rather than collapsed into "failed". */
async function signUp(): Promise<Session> {
  const email = `probe-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@${PROBE_DOMAIN}`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));

  if (response.status === 429 || body.error_code === "over_email_send_rate_limit") {
    throw new Error(
      "Signup hit the project's email rate limit. Signup is still sending " +
        "confirmation mail, which means email confirmation is enabled. Turn it " +
        "off for this project (Authentication → Sign In / Providers → Confirm " +
        "email) — the probes need a session immediately, and should not be " +
        "sending mail at all.",
    );
  }

  if (body.error_code === "email_address_invalid") {
    throw new Error(
      `The project rejected the probe address domain "${PROBE_DOMAIN}". Set ` +
        "HOSTED_PROBE_EMAIL_DOMAIN to a domain this project accepts. Supabase " +
        "refuses example.com and the reserved .invalid / .test TLDs.",
    );
  }

  if (!response.ok) {
    throw new Error(`Signup failed (${response.status}): ${JSON.stringify(body)}`);
  }

  if (!body.access_token) {
    throw new Error(
      "Signup returned no session. Email confirmation is enabled on this " +
        "project; disable it so a signup yields a usable session.",
    );
  }

  return { accessToken: body.access_token, userId: body.user.id };
}

async function rest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

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
  let alice: Session;
  let bob: Session;

  // Signed up once for the whole suite. Per-test signup burns the project's
  // email quota and turns a policy test into a rate-limit failure.
  beforeAll(async () => {
    alice = await signUp();
    bob = await signUp();
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

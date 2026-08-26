import { describe, expect, it } from "vitest";
import { apiConfig } from "./connection";

/**
 * The hosted HTTP path: Auth issues a session, PostgREST enforces RLS on it.
 *
 * This is the half the direct-SQL suite cannot reach — it proves the project's
 * API layer applies the policies, not just that the policies exist.
 *
 * Signup needs email confirmation to be off for the session to arrive
 * immediately. When it is on, signup succeeds but returns no session; the suite
 * says so and fails rather than reporting a pass it did not earn.
 */
const { supabaseUrl, publishableKey } = apiConfig();

interface Session {
  accessToken: string;
  userId: string;
  email: string;
}

async function signUp(): Promise<Session | { blocked: string }> {
  const email = `api-probe-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.invalid`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { blocked: `signup failed (${response.status}): ${JSON.stringify(body)}` };
  }
  if (!body.access_token) {
    return {
      blocked:
        "signup returned no session — email confirmation is enabled on this " +
        "project. Disable it for the test project, or supply confirmed users.",
    };
  }
  return { accessToken: body.access_token, userId: body.user.id, email };
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

describe("hosted API", () => {
  it("serves country reference data to anonymous callers", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/country_profiles?select=key`, {
      headers: { apikey: publishableKey },
    });
    expect(response.status).toBe(200);
  });

  it("denies anonymous access to tenant tables", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/trips?select=id`, {
      headers: { apikey: publishableKey },
    });
    // No grant for anon, so PostgREST reports permission denied rather than [].
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("isolates two real signed-up users through PostgREST", async () => {
    const a = await signUp();
    if ("blocked" in a) throw new Error(a.blocked);
    const b = await signUp();
    if ("blocked" in b) throw new Error(b.blocked);

    // A creates a trip.
    const created = await rest("trips", a.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: a.userId, destination_city: "Lagos" }),
    });
    expect(created.status, await created.text().catch(() => "")).toBeLessThan(300);

    // A sees it.
    const own = await rest("trips?select=id,destination_city", a.accessToken);
    expect(own.status).toBe(200);
    expect(await own.json()).toHaveLength(1);

    // B sees nothing of A's.
    const other = await rest("trips?select=id", b.accessToken);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual([]);

    // B cannot create a row owned by A.
    const forged = await rest("trips", b.accessToken, {
      method: "POST",
      body: JSON.stringify({ user_id: a.userId, destination_city: "Forged" }),
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });

  it("keeps a session valid for a follow-up request", async () => {
    const session = await signUp();
    if ("blocked" in session) throw new Error(session.blocked);

    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    expect(who.status).toBe(200);
    expect((await who.json()).id).toBe(session.userId);
  });
});

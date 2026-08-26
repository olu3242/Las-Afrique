import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { apiConfig, databaseUrl } from "./connection";

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

// `||`, not `??`. An unset GitHub secret arrives as an empty string, which is
// not nullish — `??` kept it, the address ended at "probe-xxx@", and the project
// rejected it as an invalid format rather than as a missing domain.
const PROBE_DOMAIN =
  process.env.HOSTED_PROBE_EMAIL_DOMAIN || "takemehome-probe.dev";

interface Session {
  accessToken: string;
  userId: string;
  email: string;
}

/**
 * Fetches the project's service-role key through the Management API.
 *
 * The key is not a stored secret — it is read at run time using
 * SUPABASE_ACCESS_TOKEN, which the workflow already holds for the CLI. Nothing
 * prints it.
 */
async function serviceRoleKey(): Promise<string> {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    throw new Error(
      "Creating confirmed users needs SUPABASE_PROJECT_REF and " +
        "SUPABASE_ACCESS_TOKEN so the service-role key can be read from the " +
        "Management API.",
    );
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Management API refused the api-keys request (${response.status}). The ` +
        "access token may lack project scope.",
    );
  }

  const keys = (await response.json()) as Array<{ name: string; api_key: string }>;
  const secret = keys.find((k) => k.name === "service_role");
  if (!secret?.api_key) {
    throw new Error(
      `No service_role key returned. Names present: ${keys
        .map((k) => k.name)
        .join(", ")}`,
    );
  }
  return secret.api_key;
}

/**
 * Creates a confirmed user through the Auth admin API, then signs in.
 *
 * Deliberately not public signup, and deliberately not a hand-seeded row.
 *
 * Signup is gated by the project's "Confirm email" setting: with it on, every
 * attempt sends mail and returns no session, and a few attempts exhaust the
 * email rate limit.
 *
 * Seeding auth.users directly avoided that but coupled the probes to GoTrue's
 * internal schema, and it did not hold: a hand-written row is missing the
 * related state GoTrue expects — sign-in answered 500 "Database error querying
 * schema" whichever columns were backfilled. Chasing that further would have
 * meant reverse-engineering more internals with each hosted run.
 *
 * admin/users with email_confirm is the supported route. GoTrue writes whatever
 * it needs, no mail is sent, the rate limit is irrelevant, and the project's
 * confirmation setting does not apply.
 */
async function createConfirmedUser(adminKey: string): Promise<Session> {
  const email = `probe-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@${PROBE_DOMAIN}`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdBody = await created.json().catch(() => ({}));

  if (!created.ok) {
    if (createdBody.error_code === "email_address_invalid") {
      throw new Error(
        `The project rejected the probe domain "${PROBE_DOMAIN}". Set ` +
          "HOSTED_PROBE_EMAIL_DOMAIN to one it accepts.",
      );
    }
    throw new Error(
      `admin/users refused (${created.status}): ${JSON.stringify(createdBody)}`,
    );
  }

  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.access_token) {
    throw new Error(
      `Could not sign in the admin-created user (${response.status}): ` +
        `${JSON.stringify(body)}`,
    );
  }

  return { accessToken: body.access_token, userId: createdBody.id, email };
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

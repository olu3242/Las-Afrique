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
 * Creates a confirmed user directly, then signs in for a real session.
 *
 * Deliberately not the public signup endpoint. Signup is gated by the
 * project's "Confirm email" setting: with it on, every attempt sends mail and
 * returns no session, and a handful of attempts exhaust the email rate limit —
 * so the probes could never obtain a token without changing a project setting.
 *
 * Seeding the row instead uses only what this workflow already holds: database
 * access, and pgcrypto (enabled by migration 0001) to write a bcrypt hash GoTrue
 * will verify. The session that comes back is a genuine one, issued by Auth,
 * carrying real claims — which is the point, since what these probes verify is
 * that PostgREST enforces the policies against a real token.
 */
async function createConfirmedUser(db: Client): Promise<Session> {
  const email = `probe-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@${PROBE_DOMAIN}`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', $1, crypt($2, gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
     )
     returning id`,
    [email, password],
  );
  const userId = rows[0].id;

  // GoTrue reads its token columns into non-nullable Go strings. A row seeded
  // without them leaves those NULL, the scan fails, and sign-in returns
  // 500 "Database error querying schema" — which names GoTrue's schema, not the
  // row, and sends you looking in the wrong place.
  //
  // The column set differs across GoTrue versions, so it is discovered rather
  // than hardcoded: every character-typed, nullable column on auth.users that
  // this row left NULL becomes the empty string GoTrue expects.
  const { rows: nullable } = await db.query<{ column_name: string }>(
    `select column_name
     from information_schema.columns
     where table_schema = 'auth'
       and table_name = 'users'
       and data_type in ('character varying', 'text')
       and is_nullable = 'YES'
       and column_name not in ('email', 'encrypted_password')`,
  );

  if (nullable.length > 0) {
    // Identifiers cannot be parameterised, so they are quoted — and they come
    // from information_schema, not from anything caller-supplied.
    const assignments = nullable
      .map(({ column_name }) => {
        const quoted = `"${column_name.replace(/"/g, '""')}"`;
        return `${quoted} = coalesce(${quoted}, '')`;
      })
      .join(", ");
    await db.query(`update auth.users set ${assignments} where id = $1`, [userId]);
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
      `Could not sign in the seeded user (${response.status}): ` +
        `${JSON.stringify(body)}. The row was created directly in auth.users, so ` +
        "this points at GoTrue rejecting the seeded shape rather than at any " +
        "project setting.",
    );
  }

  return { accessToken: body.access_token, userId, email };
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
    db = new Client({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    alice = await createConfirmedUser(db);
    bob = await createConfirmedUser(db);
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

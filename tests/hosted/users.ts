/**
 * Real users against the hosted project's Auth service.
 *
 * Extracted from api.test.ts when the storage suite needed the same two users.
 * Copying it would have been the smaller edit and the wrong one: these helpers
 * encode which signup route actually works against a Supabase project, and two
 * copies drift the moment one is fixed.
 */

import { apiConfig } from "./connection";

const { supabaseUrl, publishableKey } = apiConfig();

// `||`, not `??`. An unset GitHub secret arrives as an empty string, which is
// not nullish — `??` kept it, the address ended at "probe-xxx@", and the project
// rejected it as an invalid format rather than as a missing domain.
export const PROBE_DOMAIN =
  process.env.HOSTED_PROBE_EMAIL_DOMAIN || "takemehome-probe.dev";

export interface Session {
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
export async function serviceRoleKey(): Promise<string> {
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
export async function createConfirmedUser(adminKey: string): Promise<Session> {
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

/** A PostgREST request as a signed-in user. */
export async function rest(
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

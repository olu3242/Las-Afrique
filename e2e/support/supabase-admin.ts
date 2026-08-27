/**
 * Creates and removes probe users for the signed-in end-to-end journey.
 *
 * Same route the hosted probes take, and for the same reasons: public signup
 * is gated by the project's email-confirmation setting and burns the mail rate
 * limit, and hand-seeding auth.users couples the suite to GoTrue's internal
 * schema. `POST /auth/v1/admin/users` with `email_confirm` is the supported
 * way to get a usable account without sending mail.
 *
 * The service-role key is fetched at run time from the Management API with the
 * access token CI already holds. It is not a stored secret and is never
 * printed.
 */

export interface ProbeUser {
  id: string;
  email: string;
  password: string;
}

export interface AdminConfig {
  supabaseUrl: string;
  publishableKey: string;
  projectRef: string;
  accessToken: string;
}

/**
 * Reads the configuration, or explains what is missing.
 *
 * `||` rather than `??` throughout: an unset GitHub secret arrives as an empty
 * string, which is not nullish.
 */
export function adminConfig(): AdminConfig | { missing: string[] } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const projectRef = process.env.SUPABASE_PROJECT_REF || "";
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
  if (!accessToken) missing.push("SUPABASE_ACCESS_TOKEN");

  if (missing.length > 0) return { missing };
  return { supabaseUrl, publishableKey, projectRef, accessToken };
}

const PROBE_DOMAIN =
  process.env.HOSTED_PROBE_EMAIL_DOMAIN || "takemehome-probe.dev";

async function serviceRoleKey(config: AdminConfig): Promise<string> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${config.projectRef}/api-keys`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Management API refused the api-keys request (${response.status}).`,
    );
  }
  const keys = (await response.json()) as Array<{
    name: string;
    api_key: string;
  }>;
  const secret = keys.find((k) => k.name === "service_role");
  if (!secret?.api_key) throw new Error("No service_role key returned.");
  return secret.api_key;
}

export async function createProbeUser(config: AdminConfig): Promise<ProbeUser> {
  const adminKey = await serviceRoleKey(config);
  const email = `e2e-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@${PROBE_DOMAIN}`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `admin/users refused (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  return { id: body.id as string, email, password };
}

/** Cascades remove the trips and travellers the run created. */
export async function deleteProbeUser(
  config: AdminConfig,
  userId: string,
): Promise<void> {
  const adminKey = await serviceRoleKey(config);
  await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: adminKey, Authorization: `Bearer ${adminKey}` },
  });
}

/**
 * Reads rows straight out of the project, bypassing RLS.
 *
 * A diagnostic, not an assertion helper for ordinary use. Nine hosted runs of
 * the group journey each reported only that a page did not show something,
 * which is equally true whether a write failed, a read failed, or the render
 * did — and four diagnoses drawn from that ambiguity were wrong.
 *
 * A journey that can say what the database actually holds ends that guessing.
 * Use it to put real state into a failure message; never to assert on data the
 * signed-in user could not see for themselves, which would prove the wrong
 * thing entirely.
 */
export async function readAsAdmin(
  config: AdminConfig,
  path: string,
): Promise<unknown> {
  const adminKey = await serviceRoleKey(config);
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
    },
  });
  if (!response.ok) {
    return { error: response.status, body: await response.text() };
  }
  return response.json();
}

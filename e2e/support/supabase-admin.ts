import { Client } from "pg";

/**
 * Creates and removes probe users for the signed-in end-to-end journey.
 *
 * Same route the hosted probes take, and for the same reasons: public signup
 * is gated by the project's email-confirmation setting and burns the mail rate
 * limit, and hand-seeding auth.users couples the suite to GoTrue's internal
 * schema. `POST /auth/v1/admin/users` with `email_confirm` is the supported
 * way to get a usable account without sending mail.
 *
 * The privileged key is obtained one of two ways, and which one is available
 * decides nothing else about the run:
 *
 *   hosted  fetched at run time from the Management API with the access token
 *           CI already holds. Not a stored secret, and never printed.
 *   local   supplied directly, because the Supabase CLI's local stack has no
 *           Management API behind it and its service key is a static
 *           development value with no hosted project to reach.
 *
 * The direct key is preferred when present. That ordering is deliberate: a
 * developer who has both a local stack and hosted credentials exported is
 * running against the local stack, and a run that silently reached for the
 * hosted project instead would be the worst possible surprise.
 */

export interface ProbeUser {
  id: string;
  email: string;
  password: string;
}

export interface AdminConfig {
  supabaseUrl: string;
  publishableKey: string;
  /** Empty on a local stack, which has no hosted project to reference. */
  projectRef: string;
  /** Empty on a local stack, which has no Management API to authenticate to. */
  accessToken: string;
  /**
   * A privileged key supplied directly rather than fetched. Set for the local
   * stack; absent for the hosted project, where the Management API is the
   * supported route and no service-role key is stored anywhere.
   */
  directSecretKey?: string;
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

  // The local stack's key, if one was supplied. Named for what it does rather
  // than for where it came from: `lib/env.ts` accepts either generation, and
  // so does this.
  const directSecretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  // Two ways to be privileged, and a run needs exactly one of them. Reported
  // as one requirement rather than four missing names, so a developer running
  // locally is not told to go and find a hosted access token they should not
  // have.
  if (!directSecretKey) {
    if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
    if (!accessToken) missing.push("SUPABASE_ACCESS_TOKEN");
  }

  if (missing.length > 0) return { missing };
  return {
    supabaseUrl,
    publishableKey,
    projectRef,
    accessToken,
    directSecretKey: directSecretKey || undefined,
  };
}

const PROBE_DOMAIN =
  process.env.HOSTED_PROBE_EMAIL_DOMAIN || "takemehome-probe.dev";

async function serviceRoleKey(config: AdminConfig): Promise<string> {
  if (config.directSecretKey) return config.directSecretKey;

  if (!config.projectRef || !config.accessToken) {
    throw new Error(
      "No privileged key available: supply SUPABASE_SECRET_KEY for a local " +
        "stack, or SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN for the " +
        "hosted project.",
    );
  }

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
  // Direct SQL when a database connection is configured; PostgREST otherwise.
  //
  // The two tiers disagree about `service_role`, and the disagreement is not
  // this project's doing. A hosted project created under the old default
  // carries ALTER DEFAULT PRIVILEGES granting every new public table to anon,
  // authenticated *and* service_role, so reading through PostgREST as
  // service_role works there. The Supabase CLI's local stack follows the new
  // default and exposes nothing automatically, so the same read answers:
  //
  //   42501  permission denied for table group_memberships
  //   hint:  GRANT SELECT ON public.group_memberships TO service_role;
  //
  // Taking that hint would have been the wrong fix. No migration grants
  // service_role anything, no application module imports
  // lib/supabase/admin.ts, and the privilege only exists on the hosted project
  // by accident of when it was created. Adding a grant to make a *test helper*
  // work would widen exactly what migration 0016 had just finished narrowing.
  //
  // So the helper stops needing the privilege instead. A direct connection
  // bypasses row-level security because it is the owner, which is what this
  // helper was always asking for.
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (databaseUrl) {
    try {
      return await readOverSql(databaseUrl, path);
    } catch (error) {
      return { error: "sql", message: (error as Error).message };
    }
  }

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

/**
 * The narrow slice of PostgREST's query syntax these journeys actually use:
 * `table?select=a,b&col=eq.value`, optionally with `order=col.desc`.
 *
 * Deliberately narrow. A general translator would be a second query language
 * to get wrong, and the failure mode of getting it wrong is a diagnostic that
 * lies about what the database holds — which is the one thing this helper
 * exists to prevent.
 */
async function readOverSql(databaseUrl: string, path: string): Promise<unknown> {
  const [table, rawQuery = ""] = path.split("?");
  const params = new URLSearchParams(rawQuery);

  const columns = params.get("select") || "*";
  if (!/^[a-z0-9_]+$/i.test(table)) throw new Error(`unsupported table: ${table}`);
  if (!/^[a-z0-9_,*\s]+$/i.test(columns)) {
    throw new Error(`unsupported select: ${columns}`);
  }

  const wheres: string[] = [];
  const values: unknown[] = [];
  let order = "";

  for (const [key, value] of params.entries()) {
    if (key === "select") continue;
    if (key === "order") {
      const [column, direction] = value.split(".");
      if (!/^[a-z0-9_]+$/i.test(column)) throw new Error(`unsupported order: ${value}`);
      order = ` order by ${column} ${direction === "desc" ? "desc" : "asc"}`;
      continue;
    }
    const [operator, ...rest] = value.split(".");
    if (operator !== "eq") throw new Error(`unsupported operator: ${operator}`);
    if (!/^[a-z0-9_]+$/i.test(key)) throw new Error(`unsupported column: ${key}`);
    values.push(rest.join("."));
    wheres.push(`${key} = $${values.length}`);
  }

  const where = wheres.length > 0 ? ` where ${wheres.join(" and ")}` : "";
  const sql = `select ${columns} from public.${table}${where}${order}`;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(sql, values);
    return rows;
  } finally {
    await client.end();
  }
}

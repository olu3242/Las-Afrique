import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readServiceRoleKey, requirePublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role client. **Bypasses row-level security entirely.**
 *
 * The `server-only` import above makes importing this from a client component a
 * build error rather than a silent key leak.
 *
 * Use it only where a privileged operation is genuinely required — never as a
 * convenience to avoid writing a policy. Ordinary reads and writes go through
 * `lib/supabase/server.ts`, which stays inside RLS.
 */
export function createAdminClient() {
  const { url } = requirePublicSupabaseEnv();
  const serviceRoleKey = readServiceRoleKey();

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for privileged " +
        "server operations and must never be exposed to the browser.",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

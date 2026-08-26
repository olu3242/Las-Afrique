import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readSecretKey, requirePublicSupabaseEnv } from "@/lib/env";
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
  const secretKey = readSecretKey();

  if (!secretKey) {
    throw new Error(
      "No Supabase secret key is set. Set SUPABASE_SECRET_KEY (or the legacy " +
        "SUPABASE_SERVICE_ROLE_KEY). It is required for privileged server " +
        "operations and must never be exposed to the browser.",
    );
  }

  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Server Supabase client, scoped to the caller's session cookies.
 *
 * Still the anon key: this client acts *as the signed-in user*, so RLS applies.
 * That is deliberate — server code should not silently gain the power to read
 * another user's rows. Use `lib/supabase/admin.ts` when a privileged operation
 * is genuinely required.
 */
export async function createClient() {
  const { url, anonKey } = requirePublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

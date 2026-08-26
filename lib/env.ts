/**
 * Environment contract.
 *
 * Two tiers, and the split is load-bearing:
 *
 *   NEXT_PUBLIC_*  — inlined into the client bundle by Next.js. Safe to expose.
 *                    The Supabase anon key belongs here: it is protected by RLS,
 *                    not by secrecy.
 *   server-only    — must never reach the browser. Reading these from a module
 *                    that a client component imports is a security bug, so they
 *                    live behind `lib/supabase/admin.ts`, which imports
 *                    `server-only` and fails the build if pulled client-side.
 *
 * Validation is lazy. The Phase 0 marketing route must build and render with no
 * Supabase configuration present at all, so nothing here throws at import time.
 */

export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Public Supabase configuration, or null when the app is running unconfigured. */
export function getPublicSupabaseEnv(): PublicSupabaseEnv | null {
  // Next.js only inlines NEXT_PUBLIC_* when referenced as a static property path,
  // so these cannot be read through a computed key.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Same, but throws where configuration is genuinely required. */
export function requirePublicSupabaseEnv(): PublicSupabaseEnv {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example.",
    );
  }
  return env;
}

/** True when the app has enough configuration to talk to Supabase. */
export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseEnv() !== null;
}

/**
 * Server-only service-role key. Never import this from a client component.
 * Callers must be server code; `lib/supabase/admin.ts` enforces that.
 */
export function readServiceRoleKey(): string | undefined {
  return read("SUPABASE_SERVICE_ROLE_KEY");
}

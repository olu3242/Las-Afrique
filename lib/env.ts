/**
 * Environment contract.
 *
 * Two tiers, and the split is load-bearing:
 *
 *   NEXT_PUBLIC_*  — inlined into the client bundle by Next.js. Safe to expose.
 *                    The publishable key belongs here: it is protected by RLS,
 *                    not by secrecy.
 *   server-only    — must never reach the browser. Reading these from a module
 *                    that a client component imports is a security bug, so they
 *                    live behind `lib/supabase/admin.ts`, which imports
 *                    `server-only` and fails the build if pulled client-side.
 *
 * Two key generations are supported, because a project may issue either:
 *
 *   current  publishable (`sb_publishable_…`) / secret (`sb_secret_…`)
 *   legacy   anon JWT (`eyJ…`) / service-role JWT
 *
 * Both are read; the current names win when both are present. Nothing here
 * inspects or validates the key's shape — the server that issued it is the
 * authority on that, and guessing a format would only break the next rotation.
 *
 * Validation is lazy. The Phase 0 marketing route must build and render with no
 * Supabase configuration present at all, so nothing here throws at import time.
 */

export interface PublicSupabaseEnv {
  url: string;
  /** Sent as the `apikey` header. Publishable or legacy anon — both are public. */
  publishableKey: string;
}

/** Public Supabase configuration, or null when the app is running unconfigured. */
export function getPublicSupabaseEnv(): PublicSupabaseEnv | null {
  // Next.js only inlines NEXT_PUBLIC_* when referenced as a literal static
  // property path, so each name is written out rather than read through a
  // computed key or a loop. Removing these literals breaks the client build
  // silently — the values become undefined in the browser.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** Same, but throws where configuration is genuinely required. */
export function requirePublicSupabaseEnv(): PublicSupabaseEnv {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY) — see .env.example.",
    );
  }
  return env;
}

/** True when the app has enough configuration to talk to Supabase. */
export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseEnv() !== null;
}

/**
 * Server-only secret key — the one that bypasses row-level security.
 *
 * Never import this from a client component; `lib/supabase/admin.ts` enforces
 * that with `server-only`. Accepts the current secret key or the legacy
 * service-role key.
 */
export function readSecretKey(): string | undefined {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key && key.length > 0 ? key : undefined;
}

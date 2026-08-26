import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";

/** Route prefixes that require a signed-in user. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/trips",
  // Country guides are world-readable at the database layer — entry
  // requirements are not a secret, and country_profiles grants anon SELECT so
  // the destination list renders before a session exists. The *route* is still
  // gated because it renders in the authenticated shell, which offers "Sign
  // out" and assumes a user. A public country guide is a marketing-site
  // surface with its own design, not this one wearing the wrong header.
  "/countries",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refresh the Supabase session and gate protected routes.
 *
 * Two things happen here, in this order, and the order matters: the session
 * cookie is refreshed first (Server Components cannot write cookies, so this is
 * the only place it can happen), then access is decided.
 *
 * When Supabase is unconfigured — Phase 0, or a fresh checkout with no
 * .env.local — protected routes are treated as unavailable rather than open.
 * Failing closed is the only safe default for an auth gate.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = getPublicSupabaseEnv();
  if (!env) {
    return isProtectedPath(request.nextUrl.pathname)
      ? redirectToSignIn(request)
      : response;
  }

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() revalidates the token with Supabase. getSession() only decodes
  // the cookie, which a client can forge — never gate on it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    return redirectToSignIn(request);
  }

  return response;
}

/**
 * Send unauthenticated traffic to the sign-in page, carrying where it was
 * headed so signing in resumes the journey instead of dropping the user on a
 * dashboard they did not ask for.
 *
 * `next` is a path and search only — never the full URL. `safeDestination` in
 * lib/auth/actions.ts refuses anything that is not same-origin when it reads
 * this back, so a crafted link cannot turn sign-in into an open redirect.
 */
function redirectToSignIn(request: NextRequest) {
  const url = request.nextUrl.clone();
  const intended = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", intended);
  url.searchParams.set("reason", "required");
  return NextResponse.redirect(url);
}

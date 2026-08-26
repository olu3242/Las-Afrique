import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";

/** Route prefixes that require a signed-in user. */
export const PROTECTED_PREFIXES = ["/dashboard"] as const;

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
 * Iteration 1 has no sign-in page yet, so unauthenticated traffic goes to the
 * marketing home with a flag the page can act on. Iteration 2 repoints this at
 * /login once that route exists.
 */
function redirectToSignIn(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("auth", "required");
  return NextResponse.redirect(url);
}

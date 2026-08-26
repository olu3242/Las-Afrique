import { createClient } from "@/lib/supabase/server";

/**
 * Depends on the caller's session, so it is rendered per request. This also
 * keeps the build green with no Supabase configuration present, which Phase 0
 * requires: the marketing site must build on a fresh checkout.
 */
export const dynamic = "force-dynamic";

/**
 * Placeholder for the authenticated dashboard.
 *
 * Iteration 1 establishes the route, its shell and the middleware gate. The trip
 * summary, readiness meter and budget arrive in later iterations, fed by the
 * deterministic services rather than by this page.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-content px-5 py-16 sm:px-8">
      <p className="text-label">Dashboard</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Your homecoming
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/70">
        Signed in as{" "}
        <span className="text-data text-ivory">{user?.email ?? "unknown"}</span>.
      </p>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
        Trip setup, document readiness and your budget appear here as each is
        built. Nothing on this page is live yet.
      </p>
    </div>
  );
}

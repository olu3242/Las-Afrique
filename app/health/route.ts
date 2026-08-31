/**
 * Readiness, deliberately shallow.
 *
 * A container orchestrator needs one question answered: is this server
 * serving? Not "is the database reachable", which is a different question with
 * a different owner — a health check that consults Supabase reports the app
 * unhealthy during someone else's outage, and an orchestrator that believes it
 * will restart a perfectly good server in the middle of one.
 *
 * So this route renders no session, reads no database and requires no
 * configuration. It is outside both route groups, which is what keeps it that
 * way: it is not in the authenticated shell and it is not a marketing surface.
 * `middleware.ts` excludes it from session refresh for the same reason — a
 * probe every five seconds should not be issuing auth round trips.
 */

// Never prerendered to a static 200 at build time: a cached answer would be a
// health check that keeps saying yes after the server has stopped meaning it.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDashboard } from "@/lib/dashboard/service";
import { TripTimeline } from "@/components/ui/trip-timeline";
import { ReadinessPanel } from "@/components/ui/readiness-panel";
import { CountryGuideCard } from "@/components/ui/country-guide-card";

export const metadata: Metadata = {
  title: "Your trips — Take Me Home",
};

/** Depends on the caller's session, so it is rendered per request. */
export const dynamic = "force-dynamic";

function formatWindow(departOn: string | null, returnOn: string | null): string {
  if (!departOn) return "No dates yet";
  const format = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return returnOn ? `${format(departOn)} – ${format(returnOn)}` : format(departOn);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Composed from every preceding engine. Read through the same server client,
  // so RLS scopes it to the caller — no `.eq("user_id", …)` is written here,
  // because the policy is the filter.
  const { trips, focus } = await getDashboard();

  return (
    <div className="mx-auto max-w-content px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">Dashboard</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Your homecoming
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/70">
        Signed in as{" "}
        <span className="text-data text-ivory">{user?.email ?? "unknown"}</span>.
      </p>

      {trips.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-ivory/15 bg-indigo-900/40 px-6 py-8">
          <h2 className="font-display text-xl text-ivory">No trips yet</h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
            Start with where you are going. Everything else — travellers, dates,
            documents — can follow.
          </p>
          <Link
            href="/trips/new"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-sunset px-6 py-3 text-sm font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
          >
            Plan a trip
          </Link>
        </div>
      ) : (
        <>
          {focus ? (
            <section className="mt-12" aria-labelledby="focus-trip">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 id="focus-trip" className="font-display text-xl text-ivory">
                  {focus.trip.destination_city ??
                    focus.destination?.name ??
                    "Your next trip"}
                </h2>
                <Link
                  href={`/trips/${focus.trip.id}`}
                  className="inline-block py-2 text-sm text-ivory/70 underline decoration-sunset underline-offset-4 transition-colors hover:text-ivory"
                >
                  Open this trip
                </Link>
              </div>

              <div className="mt-6">
                <TripTimeline stages={focus.timeline} />
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="text-label">Readiness</h3>
                  <div className="mt-4">
                    <ReadinessPanel readiness={focus.readiness} />
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div>
                    <h3 className="text-label">Budget</h3>
                    {focus.budget.estimate.unavailableReason ? (
                      <p className="mt-4 rounded-2xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm leading-relaxed text-muted">
                        {focus.budget.estimate.unavailableReason}
                      </p>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5">
                        {/* The engine's figures, rendered. Nothing recomputed here. */}
                        <p className="text-data text-2xl text-ivory">
                          {focus.budget.estimate.planningTarget.toLocaleString("en-US")}{" "}
                          {focus.budget.estimate.currency}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          Planning target
                          {focus.budget.estimate.restsOnIllustrativeRates
                            ? " · illustrative figures"
                            : ""}
                        </p>
                      </div>
                    )}
                  </div>

                  {focus.destination ? (
                    <div>
                      <h3 className="text-label">Country guide</h3>
                      <div className="mt-4">
                        <CountryGuideCard guide={focus.destination} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <div className="mt-14 flex items-center justify-between gap-4">
            <h2 className="font-display text-xl text-ivory">
              {trips.length === 1 ? "1 trip" : `${trips.length} trips`}
            </h2>
            <Link
              href="/trips/new"
              className="inline-flex items-center justify-center rounded-full bg-sunset px-5 py-2.5 text-sm font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
            >
              Plan a trip
            </Link>
          </div>

          <ul className="mt-6 flex flex-col gap-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 transition-colors hover:border-ivory/35"
                >
                  <span className="text-base text-ivory">
                    {trip.destination_city ?? trip.destination_name ?? "Trip"}
                    {trip.destination_city && trip.destination_name ? (
                      <span className="text-muted">, {trip.destination_name}</span>
                    ) : null}
                  </span>
                  <span className="text-data text-sm text-muted">
                    {formatWindow(trip.depart_on, trip.return_on)}
                    {" · "}
                    {trip.traveler_count === 1
                      ? "1 traveller"
                      : `${trip.traveler_count} travellers`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-14 border-t border-ivory/10 pt-6 text-sm leading-relaxed text-muted">
        Core platform setup is complete. Additional capabilities will become
        available as implementation progresses.
      </p>
    </div>
  );
}

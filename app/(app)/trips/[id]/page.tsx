import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTrip } from "@/lib/trips/service";
import {
  ACCOMMODATION_TIERS,
  TRIP_PURPOSES,
} from "@/lib/trips/validation";
import { RouteMotif } from "@/components/ui/route-motif";
import { TravelerList } from "./traveler-list";
import { AddTravelerForm } from "./add-traveler-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getTrip(id);
  if (!detail) return { title: "Trip not found — Take Me Home" };
  const where = detail.trip.destination_city ?? detail.destinationName ?? "Trip";
  return { title: `${where} — Take Me Home` };
}

function label<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string | null,
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? null;
}

/** e.g. "18 December 2026". Dates are stored as plain dates, so parse as UTC. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getTrip(id);

  // Covers both "no such trip" and "someone else's trip" — RLS returns nothing
  // for either, and they should be indistinguishable from outside.
  if (!detail) notFound();

  const { trip, destinationName, travelers } = detail;

  const facts: Array<{ term: string; value: string }> = [
    { term: "Destination", value: [trip.destination_city, destinationName].filter(Boolean).join(", ") || "—" },
    { term: "Travelling from", value: [trip.origin_city, trip.origin_country].filter(Boolean).join(", ") || "Not set" },
    { term: "Departure", value: formatDate(trip.depart_on) ?? "Not set" },
    { term: "Return", value: formatDate(trip.return_on) ?? "Not set" },
    { term: "Reason", value: label(TRIP_PURPOSES, trip.purpose) ?? "Not set" },
    { term: "Party size", value: trip.party_size ? String(trip.party_size) : "Not set" },
    { term: "Staying", value: label(ACCOMMODATION_TIERS, trip.accommodation_tier) ?? "Not set" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <Link
        href="/dashboard"
        className="inline-block py-2 text-sm text-muted transition-colors hover:text-ivory"
      >
        ← All trips
      </Link>

      <p className="mt-6 text-label">Trip</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        {trip.destination_city ?? destinationName ?? "Your trip"}
      </h1>

      {/*
        The route line as a connector, with no stops of its own — the readiness
        timeline it becomes is Iteration 4's, and inventing markers for it now
        would put a second motif on the page.
      */}
      <div aria-hidden="true" className="mt-6 h-4 w-full max-w-xs text-sunset">
        <RouteMotif animated={false} stops={[]} />
      </div>

      <section className="mt-10" aria-labelledby="trip-details">
        <h2 id="trip-details" className="font-display text-xl text-ivory">
          Details
        </h2>
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.term}>
              <dt className="text-label">{fact.term}</dt>
              <dd className="mt-1.5 text-base text-ivory">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14" aria-labelledby="travellers">
        <h2 id="travellers" className="font-display text-xl text-ivory">
          Travellers
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We store the last four characters of a passport and its expiry date —
          never the full number.
        </p>

        <TravelerList travelers={travelers} tripId={trip.id} />
        <AddTravelerForm tripId={trip.id} />
      </section>

      <p className="mt-14 border-t border-ivory/10 pt-6 text-sm leading-relaxed text-muted">
        Document readiness and your budget appear here once those engines are
        built. Nothing on this page is an entry requirement — check the country
        guide and verify before you travel.
      </p>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTrip } from "@/lib/trips/service";
import {
  ACCOMMODATION_TIERS,
  TRIP_PURPOSES,
} from "@/lib/trips/validation";
import { RouteMotif } from "@/components/ui/route-motif";
import { getCountryGuide } from "@/lib/country/service";
import { CountryGuideCard } from "@/components/ui/country-guide-card";
import { getTripReadiness } from "@/lib/readiness/service";
import { ReadinessPanel } from "@/components/ui/readiness-panel";
import { getTripBudget } from "@/lib/budget/service";
import { BudgetPanel } from "@/components/ui/budget-panel";
import { listTripReminders } from "@/lib/reminders/service";
import { RemindersPanel } from "@/components/ui/reminders-panel";
import { buildPlannerTools } from "@/lib/planner/tools";
import { planTrip } from "@/lib/planner/service";
import { PlannerPanel } from "@/components/ui/planner-panel";
import { listVaultFiles } from "@/lib/vault/service";
import { VaultPanel } from "@/components/ui/vault-panel";
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

  // The trip consumes the real Country Data Service rather than restating
  // anything about the destination itself. Null when the trip has no
  // destination, or names one with no guide.
  const guide = await getCountryGuide(trip.destination_country_key);

  // Consumes the real readiness engine, which in turn consumes the real
  // country service. Derived on every request, so it cannot go stale against
  // the rows it describes.
  const readiness = await getTripReadiness(trip, travelers);

  // Every figure here comes from the deterministic engine. The panel renders
  // them and derives bar widths; it does not compute an estimate.
  const budget = await getTripBudget(trip);
  // Derived from readiness deadlines by the reminders engine; this page keeps
  // no second model of what is due.
  const reminders = await listTripReminders(trip.id);

  // The planner may only speak in terms of what the engines produced. The
  // snapshot is the complete set of things a plan is allowed to say, and a
  // plan that strays outside it is discarded rather than shown.
  const plannerTools = await buildPlannerTools(trip, travelers);
  const plan = await planTrip(plannerTools);

  // Metadata under RLS, bytes under a storage policy keyed on the object's
  // own path. Links are signed per request and expire shortly after.
  const documents = await listVaultFiles(trip.id);

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

      <section className="mt-14" aria-labelledby="readiness">
        <h2 id="readiness" className="font-display text-xl text-ivory">
          Readiness
        </h2>
        <div className="mt-5">
          <ReadinessPanel readiness={readiness} />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="planner">
        <h2 id="planner" className="font-display text-xl text-ivory">
          Your plan
        </h2>
        <div className="mt-5">
          <PlannerPanel outcome={plan} tools={plannerTools} />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="reminders">
        <h2 id="reminders" className="font-display text-xl text-ivory">
          Reminders
        </h2>
        <RemindersPanel reminders={reminders} />
      </section>

      <section className="mt-14" aria-labelledby="budget">
        <h2 id="budget" className="font-display text-xl text-ivory">
          Budget
        </h2>
        <div className="mt-5">
          <BudgetPanel budget={budget} />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="documents">
        <h2 id="documents" className="font-display text-xl text-ivory">
          Documents
        </h2>
        <div className="mt-5">
          <VaultPanel files={documents} tripId={trip.id} />
        </div>
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

      {guide ? (
        <section className="mt-14" aria-labelledby="country-guide">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="country-guide" className="font-display text-xl text-ivory">
              {guide.name} guide
            </h2>
            <Link
              href={`/countries/${guide.key}`}
              className="inline-block py-2 text-sm text-ivory/70 underline decoration-sunset underline-offset-4 transition-colors hover:text-ivory"
            >
              Open the full guide
            </Link>
          </div>

          <div className="mt-5">
            <CountryGuideCard guide={guide} />
          </div>
        </section>
      ) : null}

      <p className="mt-14 border-t border-ivory/10 pt-6 text-sm leading-relaxed text-muted">
        Document readiness and your budget appear here once those engines are
        built. Take Me Home surfaces requirements and is not the authority on
        them — verify against the official source before you travel.
      </p>
    </div>
  );
}

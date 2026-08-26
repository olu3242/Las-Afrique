import { RouteMotif } from "./route-motif";
import { ReadinessMeter } from "./readiness-meter";
import type { TripSummaryData } from "@/lib/mock-data";

interface TripSummaryProps {
  trip: TripSummaryData;
}

/**
 * The four facts that define a homecoming: where, when, how ready, how long left.
 * This is the shape the Phase 1 trip dashboard opens with.
 */
export function TripSummary({ trip }: TripSummaryProps) {
  return (
    <div className="rounded-2xl border border-ivory/10 bg-indigo-900/80 p-5 backdrop-blur sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-label">Destination</p>
          <p className="mt-1 truncate font-display text-xl text-ivory sm:text-2xl">
            {trip.city}, {trip.country}
          </p>
        </div>
        <div className="text-right">
          <p className="text-label">Travelling</p>
          <p className="text-data mt-1 text-xl text-ivory sm:text-2xl">
            {trip.travellers}
          </p>
        </div>
      </div>

      <div className="mt-5 h-14 text-ivory/40 sm:h-16">
        <RouteMotif />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-label">When</p>
          <p className="mt-1 text-sm text-ivory/90">{trip.window}</p>
        </div>
        <div>
          <p className="text-label">Until home</p>
          <p className="text-data mt-1 text-sm text-ivory/90">
            {trip.daysUntilDeparture} days
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-ivory/10 pt-5">
        <ReadinessMeter percent={trip.readinessPercent} />
      </div>
    </div>
  );
}

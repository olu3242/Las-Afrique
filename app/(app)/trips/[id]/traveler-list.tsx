import { removeTraveler } from "@/lib/trips/actions";
import type { TravelerRow } from "@/lib/supabase/types";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function TravelerList({
  travelers,
  tripId,
}: {
  travelers: TravelerRow[];
  tripId: string;
}) {
  if (travelers.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
        No travellers added yet.
      </p>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {travelers.map((traveler) => {
        const expires = formatDate(traveler.passport_expires_on);
        return (
          <li
            key={traveler.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
          >
            <div>
              <p className="text-base text-ivory">{traveler.full_name}</p>
              <p className="mt-1 text-sm text-muted">
                {traveler.relationship ?? "Traveller"}
                {traveler.passport_last4 ? (
                  <>
                    {" · "}
                    <span className="text-data">
                      ····{traveler.passport_last4}
                    </span>
                  </>
                ) : null}
                {expires ? <> · expires {expires}</> : null}
              </p>
            </div>

            <form action={removeTraveler}>
              <input type="hidden" name="travelerId" value={traveler.id} />
              <input type="hidden" name="tripId" value={tripId} />
              <button
                type="submit"
                className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
              >
                Remove
                <span className="sr-only"> {traveler.full_name}</span>
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

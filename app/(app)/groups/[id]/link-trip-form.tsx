import Link from "next/link";
import { linkTripToGroup } from "@/lib/groups/actions";
import type { TripListItem } from "@/lib/trips/service";

/**
 * Linking your own trip to the group.
 *
 * This is the step that makes a shared readiness state possible at all: the
 * state is derived from the member's own trip, so without a link there is
 * nothing to derive from and the panel honestly reports "nothing to report
 * yet".
 *
 * Its absence was a real gap — `linkTripToGroup` existed as an action with no
 * way to reach it, so a member could switch sharing on and never produce a
 * state. The hosted browser run is what found it.
 *
 * Linking exposes the trip to nobody. `group_trips` records that this person
 * is travelling on this journey; the trip itself stays behind its own policy.
 */
export function LinkTripForm({
  groupId,
  trips,
  linkedTripId,
}: {
  groupId: string;
  trips: TripListItem[];
  linkedTripId: string | null;
}) {
  if (trips.length === 0) {
    return (
      <div className="rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5">
        <h3 className="font-display text-lg text-ivory">Link your trip</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          You have no trips yet. Plan one and you can link it here, so the group
          can see you are ready without seeing the trip itself.
        </p>
        <Link
          href="/trips/new"
          className="mt-5 inline-flex items-center justify-center rounded-full border border-ivory/25 px-5 py-2.5 text-sm text-ivory transition-colors hover:border-ivory/50"
        >
          Plan a trip
        </Link>
      </div>
    );
  }

  const linked = trips.find((t) => t.id === linkedTripId);

  return (
    <form
      action={linkTripToGroup}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
    >
      <h3 className="font-display text-lg text-ivory">Link your trip</h3>
      <input type="hidden" name="groupId" value={groupId} />

      <p className="text-sm leading-relaxed text-muted">
        The group sees that you are travelling on this journey. It does not get
        access to the trip, its travellers, its documents or its budget.
      </p>

      {linked ? (
        <p className="text-sm text-ivory">
          Linked:{" "}
          <span className="text-data">
            {linked.destination_city ?? linked.destination_name ?? "your trip"}
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tripId" className="text-sm font-medium text-ivory">
          Which trip
        </label>
        <select
          id="tripId"
          name="tripId"
          defaultValue={linkedTripId ?? ""}
          className="rounded-lg border border-ivory/20 bg-indigo-950 px-3 py-2.5 text-sm text-ivory"
        >
          <option value="">Choose a trip</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.destination_city ?? trip.destination_name ?? "Trip"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-full border border-ivory/25 px-5 py-2.5 text-sm text-ivory transition-colors hover:border-ivory/50"
        >
          Link trip
        </button>
      </div>
    </form>
  );
}

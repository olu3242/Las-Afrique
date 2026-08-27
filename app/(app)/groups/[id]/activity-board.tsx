import { setParticipation } from "@/lib/groups/actions";
import { can } from "@/lib/groups/roles";
import { PARTICIPATION_OPTIONS } from "@/lib/groups/validation";
import type {
  GroupActivityParticipationRow,
  GroupActivityRow,
  GroupRole,
} from "@/lib/supabase/types";
import { ActivityForm } from "./activity-form";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * What the group is doing, and who is in.
 *
 * Nobody is forced onto a shared itinerary: the group agrees a plan and each
 * member says whether they are part of each piece of it. Opting out is a
 * first-class answer, not an absence.
 */
export function ActivityBoard({
  groupId,
  activities,
  participation,
  selfUserId,
  role,
}: {
  groupId: string;
  activities: GroupActivityRow[];
  participation: GroupActivityParticipationRow[];
  selfUserId: string | null;
  role: GroupRole | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {activities.length === 0 ? (
        <p className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
          No activities yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Group activities">
          {activities.map((activity) => {
            const going = participation.filter(
              (p) => p.activity_id === activity.id && p.state === "in",
            ).length;
            const mine = participation.find(
              (p) => p.activity_id === activity.id && p.user_id === selfUserId,
            );

            return (
              <li
                key={activity.id}
                className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
              >
                <p className="text-base text-ivory">{activity.title}</p>
                <p className="mt-1 text-data text-sm text-muted">
                  {[
                    formatDate(activity.happens_on),
                    activity.location,
                    activity.estimated_cost
                      ? `about ${activity.estimated_cost} ${activity.cost_currency ?? ""}`.trim()
                      : null,
                    `${going} going`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {selfUserId ? (
                  <form
                    action={setParticipation}
                    className="mt-4 flex flex-wrap items-end gap-3"
                  >
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="activityId" value={activity.id} />
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`going-${activity.id}`}
                        className="text-xs font-medium text-muted"
                      >
                        Are you coming?
                      </label>
                      <select
                        id={`going-${activity.id}`}
                        name="state"
                        defaultValue={mine?.state ?? "undecided"}
                        className="rounded-lg border border-ivory/20 bg-indigo-950 px-3 py-2 text-sm text-ivory"
                      >
                        {PARTICIPATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                    >
                      Save
                      <span className="sr-only"> for {activity.title}</span>
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {can(role, "create_activity") ? <ActivityForm groupId={groupId} /> : null}
    </div>
  );
}

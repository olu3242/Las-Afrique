import { removeMember } from "@/lib/groups/actions";
import { can } from "@/lib/groups/roles";
import type { GroupMemberView } from "@/lib/groups/service";
import type { GroupRole } from "@/lib/supabase/types";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Who is in the group.
 *
 * Each row shows what that member chose to share and nothing else. There is
 * deliberately no link through to anyone's trip: not because the link would be
 * awkward, but because no such read exists — the policies refuse it, and a
 * control here would be an invitation to try.
 */
export function MemberList({
  groupId,
  members,
  role,
  selfUserId,
}: {
  groupId: string;
  members: GroupMemberView[];
  role: GroupRole | null;
  selfUserId: string | null;
}) {
  if (members.length === 0) {
    return (
      <p className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
        No members yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Group members">
      {members.map(({ membership, hasLinkedTrip }) => {
        const isSelf = membership.user_id === selfUserId;
        const variation = [
          formatDate(membership.arrival_on)
            ? `arrives ${formatDate(membership.arrival_on)}`
            : null,
          formatDate(membership.departure_on)
            ? `leaves ${formatDate(membership.departure_on)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <li
            key={membership.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="text-base text-ivory">
                {membership.display_name ?? "A traveller"}
                {isSelf ? <span className="ml-2 text-label">you</span> : null}
              </p>
              <p className="mt-1 text-data text-sm text-muted">
                {membership.role}
                {variation ? ` · ${variation}` : ""}
                {hasLinkedTrip ? " · trip linked" : " · no trip linked"}
              </p>
              {!membership.shares_readiness ? (
                <p className="mt-1 text-sm text-muted">
                  Not sharing their readiness.
                </p>
              ) : null}
            </div>

            {can(role, "remove_member") && !isSelf ? (
              <form action={removeMember} className="shrink-0">
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="memberId" value={membership.user_id} />
                <button
                  type="submit"
                  className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                >
                  Remove
                  <span className="sr-only">
                    {" "}
                    {membership.display_name ?? "this member"}
                  </span>
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

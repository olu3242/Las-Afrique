import type { GroupTaskState } from "@/lib/supabase/types";

/**
 * Group readiness — deterministic, pure, and no model anywhere near it.
 *
 * Two things are aggregated: how the shared plan is going (tasks the group
 * holds), and how its people are going (a coarse state each member chose to
 * publish). The second is where the care is.
 *
 * The disclosure problem, and how it is answered
 * ----------------------------------------------
 * "7 of 8 travellers ready, 1 action required" is a useful line and a leak. In
 * a group of eight it narrows a private fact to one of eight people; in a
 * group of two it names them. Aggregation is not anonymisation — a count over
 * a small population is close to an accusation.
 *
 * So the aggregate is computed over *sharing members only*. A member who has
 * not opted in is not a silent zero, not an "unknown" bucket folded into the
 * denominator, and not counted as un-ready. They are excluded from the
 * arithmetic entirely and reported as a separate count of people who have not
 * shared.
 *
 * The consequence is the property worth having: nothing in this output moves
 * when a non-sharing member's private state changes. You cannot learn anything
 * about them by watching it. "Two members have not shared" reveals a choice
 * they made visibly, which is not the same as revealing what they are hiding.
 *
 * The one thing this engine will not do
 * -------------------------------------
 * It never reports *why* a member is not ready. `action_required` is the whole
 * answer. The blocker lives in that member's own readiness engine, behind
 * their own row-level policy, and no aggregate is entitled to restate it.
 */

/** The coarse states a member may publish. Deliberately few. */
export type MemberCoordinationState =
  | "ready"
  | "action_required"
  | "blocked"
  | "optional"
  | "complete";

export interface GroupReadinessMember {
  userId: string;
  /** What the group calls them. Null when they have shared no name. */
  displayName: string | null;
  /** Their own choice. False means they appear in no aggregate below. */
  sharesReadiness: boolean;
  /**
   * Derived from that member's own records by their own readiness engine.
   * Null when nothing is known, or when they do not share.
   */
  state: MemberCoordinationState | null;
}

export interface GroupReadinessTask {
  id: string;
  title: string;
  state: GroupTaskState;
  dueOn: string | null;
  /** Task ids this one waits on. */
  dependsOn: string[];
  /** How many people it is assigned to, and how many have finished. */
  assigneeCount: number;
  completedCount: number;
}

export interface GroupReadinessInput {
  members: GroupReadinessMember[];
  tasks: GroupReadinessTask[];
  /** Today as an ISO date. Injected so the rules are testable without clocks. */
  today: string;
}

export interface GroupReadiness {
  /** Members who publish a state, with it. Never includes a non-sharer. */
  sharing: Array<{
    userId: string;
    displayName: string | null;
    state: MemberCoordinationState;
  }>;
  /** How many members publish nothing. A count, never an identity. */
  notSharingCount: number;
  /** Members who share but whose state is not yet derivable. */
  unknownCount: number;
  /** Counts over sharing members only. */
  counts: Record<MemberCoordinationState, number>;
  /** Sharing members in a settled state, over sharing members with a state. */
  readyCount: number;
  denominator: number;
  /** Null when nobody has shared, rather than a misleading 0 or 100. */
  percent: number | null;
  /** Tasks the group can act on now, nearest deadline first. */
  actionableTasks: GroupReadinessTask[];
  /** Tasks waiting on another task rather than on a person. */
  blockedTasks: GroupReadinessTask[];
  overdueTasks: GroupReadinessTask[];
  /**
   * True when no member has shared. Consumers must say so rather than render
   * an empty progress bar, which reads as "nobody is ready".
   */
  noSharedStatus: boolean;
}

/** States that count as "this person needs nothing further from us". */
const SETTLED: MemberCoordinationState[] = ["ready", "complete", "optional"];

const EMPTY_COUNTS: Record<MemberCoordinationState, number> = {
  ready: 0,
  action_required: 0,
  blocked: 0,
  optional: 0,
  complete: 0,
};

export function deriveGroupReadiness(
  input: GroupReadinessInput,
): GroupReadiness {
  // ---- people ------------------------------------------------------------
  // The filter is the privacy boundary. Everything downstream operates on
  // `sharers` alone, so a non-sharing member cannot influence any figure.
  const sharers = input.members.filter((m) => m.sharesReadiness);
  const notSharingCount = input.members.length - sharers.length;

  const sharing = sharers
    .filter((m): m is GroupReadinessMember & { state: MemberCoordinationState } =>
      m.state !== null,
    )
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      state: m.state,
    }));

  const unknownCount = sharers.length - sharing.length;

  const counts = sharing.reduce(
    (acc, m) => {
      acc[m.state] += 1;
      return acc;
    },
    { ...EMPTY_COUNTS },
  );

  const denominator = sharing.length;
  const readyCount = SETTLED.reduce((sum, s) => sum + counts[s], 0);

  // ---- the shared plan ---------------------------------------------------
  const byId = new Map(input.tasks.map((t) => [t.id, t]));

  const isSatisfied = (id: string): boolean => byId.get(id)?.state === "done";

  const open = input.tasks.filter((t) => t.state !== "done");

  // A task is blocked when something it waits on is not done, or when it was
  // recorded as blocked outright. Waiting on a missing task counts as blocked:
  // a dependency we cannot see is not a dependency that is satisfied.
  const blockedTasks = open.filter(
    (t) =>
      t.state === "blocked" ||
      t.dependsOn.some((id) => !byId.has(id) || !isSatisfied(id)),
  );
  const blockedIds = new Set(blockedTasks.map((t) => t.id));

  const actionableTasks = sortByDeadline(
    open.filter((t) => !blockedIds.has(t.id)),
  );

  const overdueTasks = sortByDeadline(
    open.filter((t) => t.dueOn !== null && t.dueOn < input.today),
  );

  return {
    sharing,
    notSharingCount,
    unknownCount,
    counts,
    readyCount,
    denominator,
    percent:
      denominator === 0 ? null : Math.round((readyCount / denominator) * 100),
    actionableTasks,
    blockedTasks: sortByDeadline(blockedTasks),
    overdueTasks,
    noSharedStatus: denominator === 0,
  };
}

function sortByDeadline(tasks: GroupReadinessTask[]): GroupReadinessTask[] {
  return [...tasks].sort((a, b) => {
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * A member's own readiness, reduced to what a group is allowed to see.
 *
 * The input is that member's own `Readiness` summary, computed by Iteration
 * 4's engine inside their own policy. Only the verdict crosses; the items,
 * the document names and the dates do not.
 */
export function coordinationStateFrom(summary: {
  percent: number | null;
  counts: { action_needed: number; missing: number; expiring: number };
}): MemberCoordinationState | null {
  if (summary.percent === null) return null;
  if (summary.counts.action_needed > 0) return "action_required";
  if (summary.counts.expiring > 0) return "action_required";
  if (summary.counts.missing > 0) return "action_required";
  return summary.percent === 100 ? "ready" : "action_required";
}

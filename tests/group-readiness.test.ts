import { describe, expect, it } from "vitest";
import {
  coordinationStateFrom,
  deriveGroupReadiness,
  type GroupReadinessMember,
  type GroupReadinessTask,
  type MemberCoordinationState,
} from "@/lib/groups/readiness";

const TODAY = "2026-09-01";

function member(
  userId: string,
  sharesReadiness: boolean,
  state: MemberCoordinationState | null,
): GroupReadinessMember {
  return { userId, displayName: userId, sharesReadiness, state };
}

function task(
  id: string,
  over: Partial<GroupReadinessTask> = {},
): GroupReadinessTask {
  return {
    id,
    title: id,
    state: "open",
    dueOn: null,
    dependsOn: [],
    assigneeCount: 0,
    completedCount: 0,
    ...over,
  };
}

describe("group readiness — the privacy boundary", () => {
  it("excludes a non-sharing member from every figure", () => {
    const readiness = deriveGroupReadiness({
      members: [
        member("ama", true, "ready"),
        member("kofi", true, "action_required"),
        member("zainab", false, null),
      ],
      tasks: [],
      today: TODAY,
    });

    // Two sharing members, not three.
    expect(readiness.denominator).toBe(2);
    expect(readiness.notSharingCount).toBe(1);
    expect(readiness.sharing.map((m) => m.userId)).toEqual(["ama", "kofi"]);
    expect(readiness.percent).toBe(50);
  });

  it("cannot be moved by a non-sharing member's private state", () => {
    // The property that matters. Same group, same sharers; the non-sharer's
    // underlying state swings from its best to its worst value. If any figure
    // moves, watching this output leaks that member's private state.
    const withBest = deriveGroupReadiness({
      members: [
        member("ama", true, "ready"),
        member("zainab", false, "complete"),
      ],
      tasks: [],
      today: TODAY,
    });

    const withWorst = deriveGroupReadiness({
      members: [
        member("ama", true, "ready"),
        member("zainab", false, "blocked"),
      ],
      tasks: [],
      today: TODAY,
    });

    expect(withWorst).toEqual(withBest);
  });

  it("never names a non-sharing member", () => {
    const readiness = deriveGroupReadiness({
      members: [
        member("ama", true, "ready"),
        member("zainab", false, "action_required"),
      ],
      tasks: [],
      today: TODAY,
    });

    const serialised = JSON.stringify(readiness);
    expect(serialised).not.toContain("zainab");
    // The count is disclosed; the identity is not.
    expect(readiness.notSharingCount).toBe(1);
  });

  it("does not treat a non-sharing member as un-ready", () => {
    // The tempting bug: folding non-sharers into the denominator, which makes
    // declining to share look identical to being blocked.
    const readiness = deriveGroupReadiness({
      members: [
        member("ama", true, "ready"),
        member("kofi", false, null),
        member("zainab", false, null),
      ],
      tasks: [],
      today: TODAY,
    });

    expect(readiness.percent).toBe(100);
    expect(readiness.counts.action_required).toBe(0);
  });

  it("reports no shared status rather than zero when nobody has opted in", () => {
    const readiness = deriveGroupReadiness({
      members: [member("ama", false, null), member("kofi", false, null)],
      tasks: [],
      today: TODAY,
    });

    expect(readiness.noSharedStatus).toBe(true);
    expect(readiness.percent).toBeNull();
    expect(readiness.denominator).toBe(0);
  });

  it("separates a sharing member with no derivable state from a non-sharer", () => {
    const readiness = deriveGroupReadiness({
      members: [member("ama", true, null), member("kofi", false, null)],
      tasks: [],
      today: TODAY,
    });

    expect(readiness.unknownCount).toBe(1);
    expect(readiness.notSharingCount).toBe(1);
    expect(readiness.denominator).toBe(0);
  });
});

describe("group readiness — the shared plan", () => {
  it("counts settled states as ready without calling them all the same", () => {
    const readiness = deriveGroupReadiness({
      members: [
        member("a", true, "ready"),
        member("b", true, "complete"),
        member("c", true, "optional"),
        member("d", true, "blocked"),
      ],
      tasks: [],
      today: TODAY,
    });

    expect(readiness.readyCount).toBe(3);
    expect(readiness.counts.blocked).toBe(1);
    expect(readiness.percent).toBe(75);
  });

  it("treats a task waiting on an unfinished dependency as blocked", () => {
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [
        task("passport", { state: "open" }),
        task("visa", { dependsOn: ["passport"] }),
      ],
      today: TODAY,
    });

    expect(readiness.blockedTasks.map((t) => t.id)).toEqual(["visa"]);
    expect(readiness.actionableTasks.map((t) => t.id)).toEqual(["passport"]);
  });

  it("unblocks a task once its dependency is done", () => {
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [
        task("passport", { state: "done" }),
        task("visa", { dependsOn: ["passport"] }),
      ],
      today: TODAY,
    });

    expect(readiness.blockedTasks).toEqual([]);
    expect(readiness.actionableTasks.map((t) => t.id)).toEqual(["visa"]);
  });

  it("treats a dependency it cannot see as unsatisfied", () => {
    // A dependency on a task outside the visible set is not a satisfied one.
    // Failing open here would show a task as actionable because its blocker
    // was hidden.
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [task("visa", { dependsOn: ["missing-task"] })],
      today: TODAY,
    });

    expect(readiness.blockedTasks.map((t) => t.id)).toEqual(["visa"]);
    expect(readiness.actionableTasks).toEqual([]);
  });

  it("orders actionable work by nearest deadline, undated last", () => {
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [
        task("later", { dueOn: "2026-10-01" }),
        task("undated"),
        task("sooner", { dueOn: "2026-09-10" }),
      ],
      today: TODAY,
    });

    expect(readiness.actionableTasks.map((t) => t.id)).toEqual([
      "sooner",
      "later",
      "undated",
    ]);
  });

  it("reports overdue work separately from actionable work", () => {
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [
        task("late", { dueOn: "2026-08-01" }),
        task("upcoming", { dueOn: "2026-09-20" }),
      ],
      today: TODAY,
    });

    expect(readiness.overdueTasks.map((t) => t.id)).toEqual(["late"]);
    expect(readiness.actionableTasks.map((t) => t.id)).toEqual([
      "late",
      "upcoming",
    ]);
  });

  it("excludes finished work from every task bucket", () => {
    const readiness = deriveGroupReadiness({
      members: [],
      tasks: [task("done", { state: "done", dueOn: "2026-01-01" })],
      today: TODAY,
    });

    expect(readiness.actionableTasks).toEqual([]);
    expect(readiness.blockedTasks).toEqual([]);
    expect(readiness.overdueTasks).toEqual([]);
  });
});

describe("coordinationStateFrom", () => {
  it("reduces a member's readiness to a single word", () => {
    expect(
      coordinationStateFrom({
        percent: 100,
        counts: { action_needed: 0, missing: 0, expiring: 0 },
      }),
    ).toBe("ready");
  });

  it("reports action_required without saying which item", () => {
    // The whole point: the group learns that something needs doing, never
    // that it is an expired passport.
    const state = coordinationStateFrom({
      percent: 80,
      counts: { action_needed: 1, missing: 0, expiring: 0 },
    });
    expect(state).toBe("action_required");
  });

  it("returns null when nothing is checkable", () => {
    expect(
      coordinationStateFrom({
        percent: null,
        counts: { action_needed: 0, missing: 0, expiring: 0 },
      }),
    ).toBeNull();
  });

  it("does not call a partial record ready", () => {
    expect(
      coordinationStateFrom({
        percent: 50,
        counts: { action_needed: 0, missing: 0, expiring: 0 },
      }),
    ).toBe("action_required");
  });
});

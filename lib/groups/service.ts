import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTripReadiness } from "@/lib/readiness/service";
import { listTrips, type TripListItem } from "@/lib/trips/service";
import type {
  GroupActivityParticipationRow,
  GroupActivityRow,
  GroupDependencyRow,
  GroupMembershipRow,
  GroupRole,
  GroupTaskAssignmentRow,
  GroupTaskRow,
  GroupTripRow,
  TravelGroupRow,
  TravelerRow,
  TripRow,
} from "@/lib/supabase/types";
import {
  coordinationStateFrom,
  deriveGroupReadiness,
  type GroupReadiness,
} from "./readiness";

/**
 * Group reads.
 *
 * Everything here goes through `lib/supabase/server.ts`, so RLS is the filter
 * and no query writes its own membership predicate to forget later. A caller
 * who is not a member gets empty results from the database rather than a
 * check in this file.
 *
 * Where the derived status actually comes from
 * --------------------------------------------
 * A member's coordination state is computed from *their own* records, and only
 * a caller reading their own data can compute it — RLS guarantees that. So it
 * is derived for the signed-in member on their own request and stored on their
 * membership row as a coarse word, never assembled here by reading everyone's
 * trips. That is not a limitation to work around; it is the boundary doing its
 * job. `refreshOwnCoordinationState` below is the only writer.
 */

export interface GroupMemberView {
  membership: GroupMembershipRow;
  /** Whether this member has linked a trip. Never what the trip contains. */
  hasLinkedTrip: boolean;
}

export interface GroupDetail {
  group: TravelGroupRow;
  /** The caller's role, or null when they are not a member. */
  role: GroupRole | null;
  members: GroupMemberView[];
  tasks: GroupTaskRow[];
  assignments: GroupTaskAssignmentRow[];
  dependencies: GroupDependencyRow[];
  activities: GroupActivityRow[];
  participation: GroupActivityParticipationRow[];
  readiness: GroupReadiness;
  /** The caller's own membership, for the controls that act on themselves. */
  self: GroupMembershipRow | null;
  /**
   * The caller's own trips, so they can link one. Their own — RLS returns
   * nobody else's, and this never becomes a list of anyone else's journeys.
   */
  ownTrips: TripListItem[];
  /** Which of them is linked to this group, if any. */
  linkedTripId: string | null;
}

/** Groups the caller belongs to. RLS scopes it; no predicate is written here. */
export async function listGroups(): Promise<
  Array<TravelGroupRow & { member_count: number; role: GroupRole | null }>
> {
  const supabase = await createClient();

  const { data: groups, error } = await supabase
    .from("travel_groups")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load your groups: ${error.message}`);

  const rows = (groups ?? []) as TravelGroupRow[];
  if (rows.length === 0) return [];

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("group_id, user_id, role, state")
    .in(
      "group_id",
      rows.map((g) => g.id),
    );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const all = (memberships ?? []) as Array<
    Pick<GroupMembershipRow, "group_id" | "user_id" | "role" | "state">
  >;

  return rows.map((group) => {
    const forGroup = all.filter((m) => m.group_id === group.id && m.state === "active");
    return {
      ...group,
      member_count: forGroup.length,
      role: forGroup.find((m) => m.user_id === user?.id)?.role ?? null,
    };
  });
}

export async function getGroup(groupId: string): Promise<GroupDetail | null> {
  const supabase = await createClient();

  const { data: group } = await supabase
    .from("travel_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  // Covers both "no such group" and "not yours" — RLS returns nothing for
  // either, and they should be indistinguishable from outside.
  if (!group) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: members },
    { data: tasks },
    { data: assignments },
    { data: dependencies },
    { data: activities },
    { data: participation },
    { data: groupTrips },
  ] = await Promise.all([
    supabase.from("group_memberships").select("*").eq("group_id", groupId),
    supabase.from("group_tasks").select("*").eq("group_id", groupId),
    supabase.from("group_task_assignments").select("*").eq("group_id", groupId),
    supabase.from("group_dependencies").select("*").eq("group_id", groupId),
    supabase.from("group_activities").select("*").eq("group_id", groupId),
    supabase
      .from("group_activity_participation")
      .select("*")
      .eq("group_id", groupId),
    supabase.from("group_trips").select("*").eq("group_id", groupId),
  ]);

  const memberRows = ((members ?? []) as GroupMembershipRow[]).filter(
    (m) => m.state === "active",
  );
  const taskRows = (tasks ?? []) as GroupTaskRow[];
  const assignmentRows = (assignments ?? []) as GroupTaskAssignmentRow[];
  const dependencyRows = (dependencies ?? []) as GroupDependencyRow[];
  const tripRows = (groupTrips ?? []) as GroupTripRow[];

  const linked = new Set(tripRows.map((t) => t.user_id));

  const self = memberRows.find((m) => m.user_id === user?.id) ?? null;

  // The caller's own trips, for the link control. listTrips reads through the
  // same server client, so RLS scopes it to them and it cannot become a list
  // of anyone else's journeys.
  const ownTrips = self ? await listTrips() : [];
  const linkedTripId =
    tripRows.find((t) => t.user_id === user?.id)?.trip_id ?? null;

  // Coordination state comes off the membership row, which the member set for
  // themselves. Nothing here reads anyone else's trip — it could not, and the
  // group-rls suite proves it could not.
  const readiness = deriveGroupReadiness({
    members: memberRows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      sharesReadiness: m.shares_readiness,
      // Belt and braces: the schema already refuses a published state
      // without consent, and the aggregation excludes non-sharers anyway.
      state: m.shares_readiness ? m.coordination_state : null,
    })),
    tasks: taskRows.map((t) => {
      const mine = assignmentRows.filter((a) => a.task_id === t.id);
      return {
        id: t.id,
        title: t.title,
        state: t.state,
        dueOn: t.due_on,
        dependsOn: dependencyRows
          .filter((d) => d.task_id === t.id)
          .map((d) => d.depends_on_task_id),
        assigneeCount: mine.length,
        completedCount: mine.filter((a) => a.completed_at !== null).length,
      };
    }),
    today: new Date().toISOString().slice(0, 10),
  });

  return {
    group: group as TravelGroupRow,
    role: self?.role ?? null,
    members: memberRows.map((membership) => ({
      membership,
      hasLinkedTrip: linked.has(membership.user_id),
    })),
    tasks: taskRows,
    assignments: assignmentRows,
    dependencies: dependencyRows,
    activities: (activities ?? []) as GroupActivityRow[],
    participation: (participation ?? []) as GroupActivityParticipationRow[],
    readiness,
    self,
    ownTrips,
    linkedTripId,
  };
}

/**
 * Recomputes the caller's own coordination state and publishes it.
 *
 * Called on the caller's own request, inside their own policy, over their own
 * trip. It is a no-op when the member has not opted in — an opt-out must not
 * leave a stale word behind for the group to read.
 */
export async function refreshOwnCoordinationState(
  groupId: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return;

  if (!(membership as GroupMembershipRow).shares_readiness) {
    // Clearing on opt-out is the point. Leaving the last published word in
    // place would keep disclosing after the member withdrew consent.
    await supabase
      .from("group_memberships")
      .update({ coordination_state: null })
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    return;
  }

  const { data: link } = await supabase
    .from("group_trips")
    .select("trip_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!link) return;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", (link as GroupTripRow).trip_id)
    .maybeSingle();

  if (!trip) return;

  const { data: travelers } = await supabase
    .from("travelers")
    .select("*")
    .eq("trip_id", (trip as TripRow).id);

  const summary = await getTripReadiness(
    trip as TripRow,
    (travelers ?? []) as TravelerRow[],
  );

  await supabase
    .from("group_memberships")
    .update({ coordination_state: coordinationStateFrom(summary) })
    .eq("group_id", groupId)
    .eq("user_id", user.id);
}

import type { GroupRole } from "@/lib/supabase/types";

/**
 * What each role may do, stated once.
 *
 * The database enforces this — every group policy predicates on
 * `is_group_member` or `can_coordinate`. This module exists so the UI can ask
 * the same question without guessing, and so the matrix is a thing tests can
 * read rather than a rule spread across thirty-nine policies.
 *
 * The line that matters
 * --------------------
 * `owner` is the group's administrator, not a superuser over its members. No
 * capability here reaches another member's trip, travellers, documents,
 * budget or vault, because no policy grants it and no code path exists to ask.
 * An owner who wants to know whether someone is ready gets the word that
 * member chose to publish, or nothing.
 *
 * That is deliberate. A group is a coordination structure, and treating its
 * organiser as an audit authority over everyone's passport is how a travel
 * planner becomes a surveillance tool for the person who booked the flights.
 */

export type GroupCapability =
  // Reading the shared plan.
  | "view_group"
  | "view_members"
  | "view_tasks"
  | "view_activities"
  // Shaping the shared plan.
  | "edit_group"
  | "delete_group"
  | "invite_member"
  | "revoke_invitation"
  | "create_task"
  | "edit_task"
  | "assign_task"
  | "create_activity"
  | "edit_activity"
  | "set_task_dependency"
  | "remove_member"
  | "change_member_role"
  // Acting for yourself. Every member has these, and no role grants them
  // over anybody else.
  | "complete_own_assignment"
  | "set_own_participation"
  | "set_own_shared_details"
  | "link_own_trip"
  | "leave_group";

const MEMBER: GroupCapability[] = [
  "view_group",
  "view_members",
  "view_tasks",
  "view_activities",
  "complete_own_assignment",
  "set_own_participation",
  "set_own_shared_details",
  "link_own_trip",
  "leave_group",
];

const COORDINATOR: GroupCapability[] = [
  ...MEMBER,
  "invite_member",
  "revoke_invitation",
  "create_task",
  "edit_task",
  "assign_task",
  "create_activity",
  "edit_activity",
  "set_task_dependency",
  "remove_member",
];

const OWNER: GroupCapability[] = [
  ...COORDINATOR,
  "edit_group",
  "delete_group",
  "change_member_role",
];

const MATRIX: Record<GroupRole, readonly GroupCapability[]> = {
  member: MEMBER,
  coordinator: COORDINATOR,
  owner: OWNER,
};

/** Capabilities that are never granted over another member, by any role. */
export const SELF_ONLY_CAPABILITIES: readonly GroupCapability[] = [
  "complete_own_assignment",
  "set_own_participation",
  "set_own_shared_details",
  "link_own_trip",
  "leave_group",
];

export function capabilitiesFor(role: GroupRole): readonly GroupCapability[] {
  return MATRIX[role];
}

export function can(role: GroupRole | null, capability: GroupCapability): boolean {
  // Null is "not a member of this group" — the same answer as a stranger.
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

/**
 * Whether a role may act on a *different* member's row.
 *
 * Separate from `can` on purpose: "may assign a task" and "may assign a task
 * to someone else" are different questions, and collapsing them is how a
 * self-only capability quietly becomes an administrative one.
 */
export function canActOnOther(
  role: GroupRole | null,
  capability: GroupCapability,
): boolean {
  if (!can(role, capability)) return false;
  return !SELF_ONLY_CAPABILITIES.includes(capability);
}

/**
 * Roles a coordinator or owner may hand out.
 *
 * Ownership transfer is deliberately absent. It changes who can delete the
 * group and who can demote whom, so it is its own operation with its own
 * confirmation — not a value in a dropdown.
 */
export const ASSIGNABLE_ROLES: readonly GroupRole[] = ["coordinator", "member"];

export function canAssignRole(actor: GroupRole | null, target: GroupRole): boolean {
  if (!can(actor, "change_member_role")) return false;
  return ASSIGNABLE_ROLES.includes(target);
}

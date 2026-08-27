import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  SELF_ONLY_CAPABILITIES,
  can,
  canActOnOther,
  canAssignRole,
  capabilitiesFor,
  type GroupCapability,
} from "@/lib/groups/roles";
import type { GroupRole } from "@/lib/supabase/types";

const ROLES: GroupRole[] = ["owner", "coordinator", "member"];

/**
 * Capabilities that would, if any role held them over another member, reach
 * that member's private records. None may ever appear in the matrix.
 */
const FORBIDDEN_ANYWHERE = [
  "view_member_trip",
  "view_member_documents",
  "view_member_budget",
  "view_member_vault",
] as const;

describe("group roles", () => {
  it("gives a member the shared plan and nothing that shapes it", () => {
    expect(can("member", "view_tasks")).toBe(true);
    expect(can("member", "view_activities")).toBe(true);
    expect(can("member", "create_task")).toBe(false);
    expect(can("member", "assign_task")).toBe(false);
    expect(can("member", "invite_member")).toBe(false);
    expect(can("member", "remove_member")).toBe(false);
  });

  it("lets a coordinator shape the plan but not the group itself", () => {
    expect(can("coordinator", "create_task")).toBe(true);
    expect(can("coordinator", "invite_member")).toBe(true);
    expect(can("coordinator", "remove_member")).toBe(true);
    expect(can("coordinator", "delete_group")).toBe(false);
    expect(can("coordinator", "edit_group")).toBe(false);
    expect(can("coordinator", "change_member_role")).toBe(false);
  });

  it("gives the owner administration of the group", () => {
    expect(can("owner", "edit_group")).toBe(true);
    expect(can("owner", "delete_group")).toBe(true);
    expect(can("owner", "change_member_role")).toBe(true);
  });

  it("treats a non-member exactly like a stranger", () => {
    for (const capability of capabilitiesFor("member")) {
      expect(can(null, capability), capability).toBe(false);
    }
  });

  it("grants no role any capability over another member's private records", () => {
    // Stated as a property rather than a spot check: if someone later adds a
    // "view_member_documents" capability and wires it to owner, this fails.
    for (const role of ROLES) {
      const held = capabilitiesFor(role) as readonly string[];
      for (const forbidden of FORBIDDEN_ANYWHERE) {
        expect(held, `${role} must not hold ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("does not make the owner a superuser over members", () => {
    // Every self-only capability stays self-only at every role, owner included.
    for (const role of ROLES) {
      for (const capability of SELF_ONLY_CAPABILITIES) {
        expect(
          canActOnOther(role, capability),
          `${role} must not exercise ${capability} over another member`,
        ).toBe(false);
      }
    }
  });

  it("keeps every role's capabilities a superset of the one below", () => {
    const member = new Set(capabilitiesFor("member"));
    const coordinator = new Set(capabilitiesFor("coordinator"));
    const owner = new Set(capabilitiesFor("owner"));

    for (const c of member) expect(coordinator.has(c), c).toBe(true);
    for (const c of coordinator) expect(owner.has(c), c).toBe(true);
  });

  it("lets an owner hand out coordinator and member, never owner", () => {
    expect(canAssignRole("owner", "coordinator")).toBe(true);
    expect(canAssignRole("owner", "member")).toBe(true);
    // Ownership transfer is its own operation, not a dropdown value.
    expect(canAssignRole("owner", "owner")).toBe(false);
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
  });

  it("refuses role changes from anyone but the owner", () => {
    expect(canAssignRole("coordinator", "member")).toBe(false);
    expect(canAssignRole("member", "member")).toBe(false);
    expect(canAssignRole(null, "member")).toBe(false);
  });

  it("answers false for a capability no role holds", () => {
    for (const role of ROLES) {
      expect(can(role, "view_member_vault" as GroupCapability)).toBe(false);
    }
  });
});

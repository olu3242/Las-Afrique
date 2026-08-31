import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  codeFromBytes,
  decodeTouch,
  encodeTouch,
  isSameAddress,
  isTouchWithinWindow,
  isWellFormedCode,
  normaliseEmail,
} from "@/lib/referrals/attribution";
import {
  summariseOwnReferrals,
  type ReferralStatus,
} from "@/lib/referrals/lifecycle";
import {
  assertNoLeak,
  buildReferralEvent,
  nullEventSink,
  type ReferralEvent,
} from "@/lib/referrals/events";
import { validateReferralInvite } from "@/lib/referrals/validation";
import type {
  ReferralInvitationRow,
  ReferralRow,
} from "@/lib/supabase/types";

const NOW = new Date("2026-09-01T12:00:00Z");

function invitation(
  id: string,
  over: Partial<ReferralInvitationRow> = {},
): ReferralInvitationRow {
  return {
    id,
    user_id: "referrer",
    program_key: "launch",
    email: `${id}@example.test`,
    email_normalised: `${id}@example.test`,
    token_hash: `hash-${id}`,
    state: "pending",
    accepted_by: null,
    expires_at: "2026-10-01T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function referral(id: string, over: Partial<ReferralRow> = {}): ReferralRow {
  return {
    id,
    program_key: "launch",
    referrer_id: "referrer",
    referred_user_id: `referred-${id}`,
    invitation_id: null,
    state: "joined",
    code: "AMACODE01",
    touched_at: "2026-08-10T00:00:00Z",
    attributed_at: "2026-08-11T00:00:00Z",
    qualified_at: null,
    disqualified_at: null,
    disqualified_reason: null,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-11T00:00:00Z",
    ...over,
  };
}

describe("normalising an address", () => {
  it("strips a plus tag at any provider", () => {
    expect(normaliseEmail("ama+home@outlook.com")).toBe("ama@outlook.com");
  });

  it("strips dots only where the provider ignores them", () => {
    expect(normaliseEmail("a.m.a@gmail.com")).toBe("ama@gmail.com");
    expect(normaliseEmail("a.m.a@googlemail.com")).toBe("ama@googlemail.com");
    // The case that makes a universal rule wrong: at most providers these are
    // two different mailboxes, and merging them refuses a legitimate invite.
    expect(normaliseEmail("a.m.a@outlook.com")).toBe("a.m.a@outlook.com");
  });

  it("lower-cases and trims", () => {
    expect(normaliseEmail("  Ama@Example.COM ")).toBe("ama@example.com");
  });

  it("leaves something that is not an address alone rather than inventing one", () => {
    expect(normaliseEmail("not-an-address")).toBe("not-an-address");
    expect(normaliseEmail("@leading")).toBe("@leading");
  });

  it("treats a tagged alias as the same person", () => {
    expect(isSameAddress("ama@gmail.com", "a.m.a+trip@gmail.com")).toBe(true);
    expect(isSameAddress("ama@gmail.com", "kofi@gmail.com")).toBe(false);
  });
});

describe("the attribution window", () => {
  it("counts a touch inside the window", () => {
    const touch = new Date("2026-08-20T12:00:00Z");
    expect(isTouchWithinWindow(touch, NOW, 30)).toBe(true);
  });

  it("refuses a touch past the window", () => {
    const touch = new Date("2026-07-20T12:00:00Z");
    expect(isTouchWithinWindow(touch, NOW, 30)).toBe(false);
  });

  it("includes the boundary exactly", () => {
    const touch = new Date("2026-08-02T12:00:00Z");
    expect(isTouchWithinWindow(touch, NOW, 30)).toBe(true);
  });

  it("gains nothing from a touch forged into the future", () => {
    // The timestamp lives in the visitor's own cookie. Clamping is what makes
    // a forged one useless rather than powerful.
    const touch = new Date("2027-01-01T00:00:00Z");
    expect(isTouchWithinWindow(touch, NOW, 30)).toBe(true);
    expect(isTouchWithinWindow(touch, NOW, 1)).toBe(true);
  });
});

describe("the shareable code", () => {
  it("builds a code of the declared length from bytes", () => {
    const code = codeFromBytes(new Uint8Array(32).fill(7));
    expect(code).toHaveLength(CODE_LENGTH);
    expect(isWellFormedCode(code)).toBe(true);
  });

  it("uses no character that another character can be mistaken for", () => {
    // A code gets read aloud and written on paper. O/0 and I/1/L in the same
    // alphabet turn an attribution into a support conversation.
    const all = Array.from({ length: 256 }, (_, i) =>
      codeFromBytes(new Uint8Array(CODE_LENGTH).fill(i)),
    ).join("");
    for (const forbidden of ["0", "O", "1", "I", "L"]) {
      expect(all, `code alphabet must not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("accepts the shape the schema accepts, and refuses what it refuses", () => {
    expect(isWellFormedCode("abcd1234")).toBe(true);
    expect(isWellFormedCode("SHORT12")).toBe(false);
    expect(isWellFormedCode("HAS-A-HYPHEN-XX")).toBe(false);
  });
});

describe("the touch cookie", () => {
  it("round-trips", () => {
    const touch = { candidate: "AMACODE01", touchedAt: NOW.toISOString() };
    expect(decodeTouch(encodeTouch(touch))).toEqual(touch);
  });

  it("returns null for anything a visitor might have edited", () => {
    // This parses a cookie any visitor can rewrite. A malformed one means "no
    // referral", never "fail the signup" — which is why nothing here throws.
    for (const value of [
      undefined,
      "",
      "not json",
      "{}",
      '{"candidate":"AMACODE01"}',
      '{"candidate":123,"touchedAt":"2026-09-01T00:00:00Z"}',
      '{"candidate":"short","touchedAt":"2026-09-01T00:00:00Z"}',
      '{"candidate":"AMACODE01","touchedAt":"not a date"}',
      '["AMACODE01"]',
      "null",
    ]) {
      expect(decodeTouch(value), String(value)).toBeNull();
    }
  });

  it("refuses an absurdly long candidate", () => {
    const value = JSON.stringify({
      candidate: "A".repeat(500),
      touchedAt: NOW.toISOString(),
    });
    expect(decodeTouch(value)).toBeNull();
  });
});

describe("what a referrer is shown", () => {
  it("names an address the referrer invited themselves", () => {
    const summary = summariseOwnReferrals({
      invitations: [invitation("ama")],
      referrals: [referral("r1", { invitation_id: "ama", state: "qualified", qualified_at: "2026-08-20T00:00:00Z" })],
    });

    expect(summary.referrals).toHaveLength(1);
    expect(summary.referrals[0]).toMatchObject({
      status: "qualified",
      invitedAddress: "ama@example.test",
    });
  });

  it("names nobody when a link was shared rather than a person invited", () => {
    // The distinction the whole boundary rests on. The referrer already knew
    // the address they typed; they never knew who picked up a link posted in a
    // group chat, and the engine will not tell them.
    const summary = summariseOwnReferrals({
      invitations: [],
      referrals: [referral("r1")],
    });

    expect(summary.referrals[0].invitedAddress).toBeNull();
    expect(summary.counts.joined).toBe(1);
  });

  it("never carries the referred user's id", () => {
    // Stated as a property of the serialised output rather than a spot check:
    // if someone later adds the id to the view type, this fails.
    const summary = summariseOwnReferrals({
      invitations: [invitation("ama")],
      referrals: [referral("r1", { referred_user_id: "kofi-uuid" })],
    });

    expect(JSON.stringify(summary)).not.toContain("kofi-uuid");
  });

  it("shows a pending invitation as invited", () => {
    const summary = summariseOwnReferrals({
      invitations: [invitation("waiting")],
      referrals: [],
    });
    expect(summary.referrals[0].status).toBe("invited");
    expect(summary.counts.invited).toBe(1);
  });

  it("does not show an invitation twice once it has been attributed", () => {
    // attribute_referral closes the invitation in the same statement that
    // writes the referral, so `accepted` is the marker rather than a join.
    const summary = summariseOwnReferrals({
      invitations: [invitation("ama", { state: "accepted", accepted_by: "kofi" })],
      referrals: [referral("r1", { invitation_id: "ama" })],
    });

    expect(summary.referrals).toHaveLength(1);
    expect(summary.referrals[0].status).toBe("joined");
  });

  it("counts a withdrawn or lapsed invitation without listing it", () => {
    const summary = summariseOwnReferrals({
      invitations: [
        invitation("gone", { state: "revoked" }),
        invitation("stale", { state: "expired" }),
      ],
      referrals: [],
    });
    expect(summary.referrals).toEqual([]);
    expect(summary.lapsedCount).toBe(2);
  });

  it("keeps a reversal visible rather than making it vanish", () => {
    // An entitlement or referral that silently disappears is indistinguishable
    // from a bug, to the user and to us.
    const summary = summariseOwnReferrals({
      invitations: [],
      referrals: [
        referral("r1", {
          state: "disqualified",
          disqualified_at: "2026-08-25T00:00:00Z",
          disqualified_reason: "ring detected",
        }),
      ],
    });
    expect(summary.referrals[0].status).toBe("disqualified");
    expect(summary.counts.disqualified).toBe(1);
  });

  it("orders the newest first", () => {
    const summary = summariseOwnReferrals({
      invitations: [invitation("new", { created_at: "2026-08-30T00:00:00Z" })],
      referrals: [
        referral("older", { attributed_at: "2026-08-01T00:00:00Z" }),
        referral("newer", { attributed_at: "2026-08-15T00:00:00Z" }),
      ],
    });
    expect(summary.referrals.map((r) => r.key)).toEqual([
      "new",
      "newer",
      "older",
    ]);
  });

  it("gives every status a label and a glyph", async () => {
    const { REFERRAL_STATUS_LABELS } = await import("@/lib/referrals/lifecycle");
    const statuses: ReferralStatus[] = [
      "invited",
      "joined",
      "qualified",
      "disqualified",
    ];
    for (const status of statuses) {
      // State is never conveyed by colour alone.
      expect(REFERRAL_STATUS_LABELS[status].label.length).toBeGreaterThan(0);
      expect(REFERRAL_STATUS_LABELS[status].glyph.length).toBeGreaterThan(0);
    }
  });
});

describe("analytics events", () => {
  it("builds an event carrying only the programme and a pseudonymous actor", () => {
    const event = buildReferralEvent({
      name: "referral.qualified",
      programKey: "launch",
      actorRef: "abc123",
      at: NOW,
    });
    expect(event).toEqual({
      name: "referral.qualified",
      at: NOW.toISOString(),
      programKey: "launch",
      actorRef: "abc123",
    });
  });

  it("refuses a payload that would disclose the referred user", () => {
    // The rule §10 states, enforced on the payload rather than trusted to each
    // call site — because the leak this guards against is the one somebody
    // adds later "just for debugging".
    for (const key of [
      "email",
      "referred_user_id",
      "tripId",
      "passportExpiry",
      "readiness",
    ]) {
      const leaky = {
        name: "referral.qualified",
        at: NOW.toISOString(),
        programKey: "launch",
        actorRef: "abc123",
        [key]: "anything",
      } as unknown as ReferralEvent;
      expect(() => assertNoLeak(leaky), key).toThrow(/may not carry/);
    }
  });

  it("refuses an unrecognised key even when it looks harmless", () => {
    const extra = {
      name: "referral.qualified",
      at: NOW.toISOString(),
      programKey: "launch",
      actorRef: "abc123",
      note: "harmless",
    } as unknown as ReferralEvent;
    expect(() => assertNoLeak(extra)).toThrow(/unrecognised key/);
  });

  it("validates through the sink that is actually in force", () => {
    // No destination exists, so the sink discards. It still validates, which
    // is what keeps the call sites exercised rather than dormant.
    expect(() =>
      nullEventSink.record(
        buildReferralEvent({
          name: "referral.code_created",
          programKey: "launch",
          actorRef: "abc123",
          at: NOW,
        }),
      ),
    ).not.toThrow();
  });
});

describe("invite validation", () => {
  it("asks for an address", () => {
    expect(validateReferralInvite({ email: null, ownEmail: "a@b.test" })).toEqual({
      email: "Enter an email address.",
    });
  });

  it("refuses something that is not an address", () => {
    expect(
      validateReferralInvite({ email: "not-an-address", ownEmail: null }).email,
    ).toMatch(/does not look like/);
  });

  it("says plainly when someone invites themselves", () => {
    expect(
      validateReferralInvite({
        email: "a.m.a+trip@gmail.com",
        ownEmail: "ama@gmail.com",
      }).email,
    ).toBe("That is your own address.");
  });

  it("accepts an ordinary address", () => {
    expect(
      validateReferralInvite({ email: "kofi@example.test", ownEmail: "ama@example.test" }),
    ).toEqual({});
  });
});

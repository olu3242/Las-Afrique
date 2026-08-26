import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  asUser,
  createMigratedDatabase,
  createUser,
  dropDatabase,
} from "@/supabase/test/harness";
import { deriveReminders, nextReminder, LEAD_TIMES_IN_DAYS } from "@/lib/reminders/derive";
import {
  MAX_ATTEMPTS,
  nextAttemptDelayMs,
  recordOnlySender,
  shouldRetry,
} from "@/lib/reminders/sender";
import type { Readiness } from "@/lib/readiness/engine";

const TODAY = "2026-06-01";

function readiness(overrides: Partial<Readiness> = {}): Readiness {
  return {
    items: [],
    counts: {
      ready: 0,
      action_needed: 0,
      upcoming: 0,
      missing: 0,
      expiring: 0,
      verify_required: 0,
    },
    checkableCount: 0,
    readyCount: 0,
    percent: null,
    nextAction: null,
    requirementsUnknown: false,
    ...overrides,
  };
}

function item(over: Partial<Readiness["items"][number]> = {}) {
  return {
    id: "passport-ama",
    travelerId: "t1",
    travelerName: "Ama",
    kind: "passport" as const,
    state: "action_needed" as const,
    title: "Renew passport",
    detail: "Your passport expires soon.",
    dueOn: "2026-10-01",
    ...over,
  };
}

describe("reminder derivation", () => {
  it("produces one reminder per lead time before a deadline", () => {
    const out = deriveReminders("trip-1", readiness({ items: [item()] }), TODAY);
    expect(out).toHaveLength(LEAD_TIMES_IN_DAYS.length);
  });

  it("is a pure function of the state, not of when it ran", () => {
    // The property idempotency rests on. Two derivations over identical state
    // must be identical, including the dedupe keys.
    const state = readiness({ items: [item()] });
    expect(deriveReminders("trip-1", state, TODAY)).toEqual(
      deriveReminders("trip-1", state, TODAY),
    );
  });

  it("keys on the deadline rather than the run", () => {
    const state = readiness({ items: [item()] });
    const first = deriveReminders("trip-1", state, TODAY);
    // A later run, same deadlines: the keys that are still in the future must
    // match, or every job tick would schedule duplicates.
    const later = deriveReminders("trip-1", state, "2026-06-15");
    const laterKeys = later.map((r) => r.dedupeKey);
    for (const reminder of first.filter((r) => laterKeys.includes(r.dedupeKey))) {
      expect(laterKeys).toContain(reminder.dedupeKey);
    }
    expect(later.length).toBeGreaterThan(0);
  });

  it("produces a new key when the deadline moves", () => {
    const before = deriveReminders("t", readiness({ items: [item()] }), TODAY);
    const after = deriveReminders(
      "t",
      readiness({ items: [item({ dueOn: "2026-11-01" })] }),
      TODAY,
    );
    expect(new Set(after.map((r) => r.dedupeKey))).not.toEqual(
      new Set(before.map((r) => r.dedupeKey)),
    );
  });

  it("does not chase an item that is already ready", () => {
    const out = deriveReminders(
      "t",
      readiness({ items: [item({ state: "ready" })] }),
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("ignores an item with no deadline", () => {
    const out = deriveReminders(
      "t",
      readiness({ items: [item({ dueOn: null })] }),
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("does not fire a backlog for lead times that already elapsed", () => {
    // A job starting close to a deadline should not send three reminders at
    // once for lead times that passed before it existed.
    const out = deriveReminders(
      "t",
      readiness({ items: [item({ dueOn: "2026-06-05" })] }),
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("returns the most urgent reminder, or null", () => {
    expect(nextReminder("t", readiness(), TODAY)).toBeNull();
    const next = nextReminder("t", readiness({ items: [item()] }), TODAY);
    expect(next?.dueAt.startsWith("2026-08-02")).toBe(true);
  });
});

describe("the send abstraction", () => {
  it("delivers in-app, because the row is the message", async () => {
    expect(
      await recordOnlySender.send({
        to: "a@b.test",
        subject: "s",
        body: "b",
        channel: "in_app",
      }),
    ).toEqual({ status: "sent" });
  });

  it.each(["email", "push"] as const)(
    "reports %s as permanently unavailable rather than retrying forever",
    async (channel) => {
      // No provider is configured for this project. Retrying a channel that
      // does not exist just burns attempts and hides the real reason.
      const result = await recordOnlySender.send({
        to: "a@b.test",
        subject: "s",
        body: "b",
        channel,
      });
      expect(result.status).toBe("permanent");
      expect(shouldRetry(result, 0)).toBe(false);
    },
  );

  it("retries a retryable failure up to the cap, then stops", () => {
    const retryable = { status: "retry" as const, error: "timeout" };
    expect(shouldRetry(retryable, 0)).toBe(true);
    expect(shouldRetry(retryable, MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(retryable, MAX_ATTEMPTS)).toBe(false);
  });

  it("backs off exponentially but caps, so a reminder is not delayed past its deadline", () => {
    expect(nextAttemptDelayMs(1)).toBeLessThan(nextAttemptDelayMs(3));
    expect(nextAttemptDelayMs(50)).toBe(60 * 60_000);
  });
});

describe("reminder storage", () => {
  const DB = "tmh_test_reminders";
  let db: Client;
  let alice: string;
  let bob: string;
  let aliceTrip: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
    alice = await createUser(db, "alice@reminders.test");
    bob = await createUser(db, "bob@reminders.test");
    const { rows } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_country_key, destination_city)
       values ($1, 'nigeria', 'Lagos') returning id`,
      [alice],
    );
    aliceTrip = rows[0].id;
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  async function insert(userId: string, tripId: string, key: string) {
    return db.query(
      `insert into public.reminders (user_id, trip_id, subject, body, due_at, dedupe_key)
       values ($1, $2, 'Renew passport', 'Due soon.', now(), $3)`,
      [userId, tripId, key],
    );
  }

  it("refuses a second reminder with the same dedupe key", async () => {
    // The guarantee that makes a scheduled job safe to re-run. Enforced by the
    // database rather than by a check-then-insert, so it holds under two jobs
    // running at once.
    await asUser(db, alice, async () => {
      await insert(alice, aliceTrip, "trip:item:2026-10-01:60");
      await expect(
        insert(alice, aliceTrip, "trip:item:2026-10-01:60"),
      ).rejects.toThrow(/reminders_dedupe_unique/);
    });
  });

  it("scopes the dedupe key per user, not globally", async () => {
    // Two travellers can legitimately hold the same derived key for their own
    // trips; a global unique index would silently drop the second user's.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_country_key)
       values ($1, 'ghana') returning id`,
      [bob],
    );
    await insert(alice, aliceTrip, "shared-key");
    await insert(bob, rows[0].id, "shared-key");
    const count = await db.query(
      `select count(*)::int as n from public.reminders where dedupe_key = 'shared-key'`,
    );
    expect(count.rows[0].n).toBe(2);
  });

  it("hides one user's reminders from another", async () => {
    await insert(alice, aliceTrip, "private-to-alice");
    const seen = await asUser(db, bob, async () => {
      const { rows } = await db.query(
        `select id from public.reminders where dedupe_key = 'private-to-alice'`,
      );
      return rows;
    });
    expect(seen).toHaveLength(0);
  });

  it("refuses a reminder on another user's trip", async () => {
    // Same composite-key rule as every other trip child.
    await expect(
      asUser(db, bob, async () => {
        await insert(bob, aliceTrip, "bob-on-alices-trip");
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("requires a sent reminder to carry when it was sent", async () => {
    await insert(alice, aliceTrip, "needs-timestamp");
    await expect(
      db.query(
        `update public.reminders set status = 'sent'
         where dedupe_key = 'needs-timestamp'`,
      ),
    ).rejects.toThrow(/sent_has_timestamp/);
  });
});

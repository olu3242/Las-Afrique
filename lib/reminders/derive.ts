import type { Readiness, ReadinessItem } from "@/lib/readiness/engine";

/**
 * Turns readiness deadlines into reminders.
 *
 * Pure, and deliberately does not keep a second deadline model. The readiness
 * engine owns what is due and when; this decides only *when to say something
 * about it* and *what to say*. A reminders system with its own idea of
 * deadlines is one that will eventually disagree with the screen the traveller
 * is looking at.
 *
 * The dedupe key is the load-bearing output. It is derived from what the
 * reminder is about — trip, item, the deadline itself — and never from the
 * time the job ran, so two runs over the same state produce the same key and
 * the database refuses the second insert. That is what makes a scheduled job
 * safe to retry.
 */

export interface DerivedReminder {
  tripId: string;
  subject: string;
  body: string;
  /** ISO timestamp. */
  dueAt: string;
  dedupeKey: string;
}

/**
 * How far ahead of a deadline to send.
 *
 * Chosen as a cadence, not derived from any rule: renewing a passport takes
 * weeks, so a reminder the day before is useless. Exported so the choice is
 * visible rather than buried.
 */
export const LEAD_TIMES_IN_DAYS = [60, 30, 7] as const;

export function deriveReminders(
  tripId: string,
  readiness: Readiness,
  today: string,
): DerivedReminder[] {
  const reminders: DerivedReminder[] = [];

  for (const item of readiness.items) {
    // Nothing to remind about without a date, and nothing worth chasing on an
    // item that is already in order.
    if (!item.dueOn) continue;
    if (item.state === "ready") continue;

    for (const lead of LEAD_TIMES_IN_DAYS) {
      const sendOn = shiftDays(item.dueOn, -lead);
      // Already past — a scheduled job starting today should not fire a
      // backlog of reminders for lead times that have elapsed.
      if (sendOn < today) continue;

      reminders.push({
        tripId,
        subject: item.title,
        body: `${item.detail} Due ${formatDate(item.dueOn)}.`,
        dueAt: `${sendOn}T09:00:00Z`,
        // Trip, item and deadline. Not the run time, and not the lead time's
        // *date*, so a deadline that moves produces a new key and one that
        // does not produces the same one however often the job runs.
        dedupeKey: `${tripId}:${item.id}:${item.dueOn}:${lead}`,
      });
    }
  }

  // Stable order so two runs produce identical output, which is what makes
  // the idempotency observable rather than incidental.
  return reminders.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
}

/** The single most urgent thing, as a reminder. Null when nothing is due. */
export function nextReminder(
  tripId: string,
  readiness: Readiness,
  today: string,
): DerivedReminder | null {
  const all = deriveReminders(tripId, readiness, today);
  if (all.length === 0) return null;
  return [...all].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type { ReadinessItem };

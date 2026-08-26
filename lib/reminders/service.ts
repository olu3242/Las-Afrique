import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ReminderRow, TravelerRow, TripRow } from "@/lib/supabase/types";
import { getTripReadiness } from "@/lib/readiness/service";
import { deriveReminders } from "./derive";
import {
  recordOnlySender,
  shouldRetry,
  type ReminderSender,
  type SendResult,
} from "./sender";

/**
 * Scheduling and dispatch.
 *
 * The two properties this engine has to actually have, rather than claim:
 *
 *   Idempotency. Running the scheduler twice over unchanged state must not
 *   produce two reminders. The dedupe key comes from the deadline, never the
 *   run, and `reminders_dedupe_unique` refuses the second row — so it holds
 *   even if two jobs run concurrently, which an in-code "check then insert"
 *   would not.
 *
 *   An audit trail. Every attempt updates attempts, last_error, status and
 *   sent_at, so what happened to a reminder is answerable afterwards from the
 *   row rather than from logs nobody kept.
 */

export interface ScheduleOutcome {
  derived: number;
  inserted: number;
  /** Already present from an earlier run. The number that proves idempotency. */
  skipped: number;
}

/**
 * Derive this trip's reminders and store the ones not already stored.
 *
 * Deadlines come from the readiness engine — this keeps no second model of
 * what is due, so a reminder cannot disagree with the screen the traveller is
 * looking at.
 */
export async function scheduleTripReminders(
  trip: TripRow,
  travelers: TravelerRow[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ScheduleOutcome> {
  const readiness = await getTripReadiness(trip, travelers);
  const derived = deriveReminders(trip.id, readiness, today);
  if (derived.length === 0) return { derived: 0, inserted: 0, skipped: 0 };

  const supabase = await createClient();

  // ignoreDuplicates, not a merge. A reminder already scheduled must not have
  // its attempt count or status reset by a later scheduling run — that would
  // resurrect a permanently failed send on every job tick.
  const { data, error } = await supabase
    .from("reminders")
    .upsert(
      derived.map((reminder) => ({
        user_id: trip.user_id,
        trip_id: reminder.tripId,
        subject: reminder.subject,
        body: reminder.body,
        due_at: reminder.dueAt,
        dedupe_key: reminder.dedupeKey,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw new Error(`Could not schedule reminders: ${error.message}`);

  const inserted = data?.length ?? 0;
  return {
    derived: derived.length,
    inserted,
    skipped: derived.length - inserted,
  };
}

/** Pending reminders that have come due, oldest first. */
export async function dueReminders(
  now: string = new Date().toISOString(),
): Promise<ReminderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at", { ascending: true });

  if (error) throw new Error(`Could not load reminders: ${error.message}`);
  return data ?? [];
}

export interface DispatchOutcome {
  considered: number;
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Attempt every due reminder once, and record what happened.
 *
 * One attempt per reminder per run, deliberately: retrying in a loop here
 * would turn a transient outage into a burst against the same provider, and
 * the next scheduled run is the natural backoff.
 */
export async function dispatchDueReminders(
  recipient: string,
  sender: ReminderSender = recordOnlySender,
  now: string = new Date().toISOString(),
): Promise<DispatchOutcome> {
  const supabase = await createClient();
  const due = await dueReminders(now);

  const outcome: DispatchOutcome = {
    considered: due.length,
    sent: 0,
    retrying: 0,
    failed: 0,
  };

  for (const reminder of due) {
    let result: SendResult;
    try {
      result = await sender.send({
        to: recipient,
        subject: reminder.subject,
        body: reminder.body,
        channel: reminder.channel,
      });
    } catch (thrown) {
      // A sender that throws is a retryable failure, not a crashed job. One
      // bad reminder must not stop the rest of the queue.
      result = {
        status: "retry",
        error: thrown instanceof Error ? thrown.message : String(thrown),
      };
    }

    const attempts = reminder.attempts + 1;
    const patch =
      result.status === "sent"
        ? { status: "sent" as const, attempts, sent_at: now, last_error: null }
        : shouldRetry(result, attempts)
          ? { status: "pending" as const, attempts, last_error: result.error }
          : { status: "failed" as const, attempts, last_error: result.error };

    const { error } = await supabase
      .from("reminders")
      .update(patch)
      .eq("id", reminder.id);

    // Recording the outcome is the audit trail; failing to record it is worse
    // than failing to send, because the next run cannot tell what happened.
    if (error) {
      throw new Error(
        `Sent or attempted reminder ${reminder.id} but could not record the ` +
          `outcome: ${error.message}`,
      );
    }

    if (patch.status === "sent") outcome.sent += 1;
    else if (patch.status === "pending") outcome.retrying += 1;
    else outcome.failed += 1;
  }

  return outcome;
}

/** A trip's reminders, newest deadline last. */
export async function listTripReminders(
  tripId: string,
): Promise<ReminderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("trip_id", tripId)
    .order("due_at", { ascending: true });

  if (error) throw new Error(`Could not load reminders: ${error.message}`);
  return data ?? [];
}

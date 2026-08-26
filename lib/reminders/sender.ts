/**
 * The send abstraction.
 *
 * Delivery is behind an interface because no channel is configured for this
 * project — there is no mail provider and no push service. Rather than
 * pretending otherwise, the default sender records the attempt and reports
 * that it did not deliver, which is what the audit trail should say.
 *
 * The retry contract is the useful part and it is real: a send either
 * succeeds, fails retryably, or fails permanently, and the caller treats those
 * three differently. A permanent failure retried forever is a queue that never
 * drains.
 */

export interface SendRequest {
  to: string;
  subject: string;
  body: string;
  channel: "email" | "push" | "in_app";
}

export type SendResult =
  | { status: "sent" }
  | { status: "retry"; error: string }
  | { status: "permanent"; error: string };

export interface ReminderSender {
  send(request: SendRequest): Promise<SendResult>;
}

/**
 * Records rather than delivers.
 *
 * `in_app` genuinely is delivered — the reminder row *is* the in-app message,
 * so writing it is the delivery. Everything else has nowhere to go, and says
 * so permanently rather than retryably: retrying a channel that does not
 * exist just burns attempts.
 */
export const recordOnlySender: ReminderSender = {
  async send(request) {
    if (request.channel === "in_app") return { status: "sent" };
    return {
      status: "permanent",
      error: `No ${request.channel} provider is configured for this project.`,
    };
  },
};

/** How many times a retryable failure is worth trying. */
export const MAX_ATTEMPTS = 5;

/** Whether another attempt is warranted, given what happened and how often. */
export function shouldRetry(result: SendResult, attempts: number): boolean {
  if (result.status !== "retry") return false;
  return attempts < MAX_ATTEMPTS;
}

/**
 * Exponential backoff, capped.
 *
 * Uncapped doubling reaches days by attempt ten, which for a deadline-driven
 * reminder means it arrives after the deadline.
 */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * 60_000, 60 * 60_000);
}

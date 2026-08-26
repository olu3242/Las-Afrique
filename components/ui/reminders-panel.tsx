import type { ReminderRow } from "@/lib/supabase/types";

/**
 * What is scheduled to be said, and what happened when it was.
 *
 * Shows the audit trail rather than hiding it: a reminder that failed to send
 * says so, with the reason. A traveller who thinks they will be reminded and
 * is not is worse off than one who knows they will not be.
 */

const STATE: Record<
  ReminderRow["status"],
  { glyph: string; label: string; tone: string }
> = {
  pending: { glyph: "○", label: "Scheduled", tone: "text-muted" },
  sent: { glyph: "✓", label: "Sent", tone: "text-baobab-light" },
  failed: { glyph: "!", label: "Not delivered", tone: "text-sunset" },
  cancelled: { glyph: "–", label: "Cancelled", tone: "text-muted" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function RemindersPanel({ reminders }: { reminders: ReminderRow[] }) {
  if (reminders.length === 0) {
    return (
      <p className="mt-5 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm leading-relaxed text-muted">
        Nothing is scheduled yet. Reminders are derived from your document
        deadlines, so they appear once a deadline does.
      </p>
    );
  }

  return (
    <ul className="mt-5 flex flex-col gap-3">
      {reminders.map((reminder) => {
        const state = STATE[reminder.status];
        return (
          <li
            key={reminder.id}
            className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-base text-ivory">{reminder.subject}</p>
              {/* Glyph and label together, so the state does not rest on colour. */}
              <p className={`flex items-center gap-2 text-sm ${state.tone}`}>
                <span aria-hidden="true">{state.glyph}</span>
                <span>{state.label}</span>
              </p>
            </div>

            <p className="mt-1.5 text-sm text-muted">
              <span className="text-data">{formatDate(reminder.due_at)}</span>
              {reminder.attempts > 0 ? (
                <>
                  {" · "}
                  {reminder.attempts === 1
                    ? "1 attempt"
                    : `${reminder.attempts} attempts`}
                </>
              ) : null}
            </p>

            {reminder.last_error ? (
              // The honest part. Saying "not delivered" without saying why
              // leaves the traveller unable to do anything about it.
              <p className="mt-2 text-sm leading-relaxed text-ivory/70">
                {reminder.last_error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

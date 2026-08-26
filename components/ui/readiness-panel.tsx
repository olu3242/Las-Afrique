import type { Readiness, ReadinessItem } from "@/lib/readiness/engine";
import type { ReadinessState } from "@/lib/supabase/types";

/**
 * Readiness as the traveller sees it.
 *
 * Receives a computed result and renders it. It derives bar widths and nothing
 * else — no state is decided here, and no figure is recomputed.
 *
 * Every state pairs a glyph with a text label, so none of it depends on
 * colour.
 */

const STATE: Record<ReadinessState, { label: string; glyph: string; className: string }> = {
  ready: {
    label: "Recorded",
    glyph: "✓",
    // baobab-light, not baobab: small text on a baobab tint falls below AA.
    className: "border-baobab/40 bg-baobab/15 text-baobab-light",
  },
  action_needed: {
    label: "Action needed",
    glyph: "!",
    className: "border-sunset/50 bg-sunset/15 text-sunset",
  },
  expiring: {
    label: "Expiring",
    glyph: "◷",
    className: "border-sunset/50 bg-sunset/15 text-sunset",
  },
  missing: {
    label: "Missing",
    glyph: "×",
    className: "border-ivory/25 bg-ivory/5 text-ivory/70",
  },
  upcoming: {
    label: "Upcoming",
    glyph: "→",
    className: "border-muted/40 bg-muted/10 text-muted",
  },
  verify_required: {
    label: "Verify",
    glyph: "◌",
    className: "border-ivory/25 bg-indigo-800/50 text-ivory/80",
  },
};

function Badge({ state }: { state: ReadinessState }) {
  const meta = STATE[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${meta.className}`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  );
}

export function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  const { percent, checkableCount, readyCount, nextAction, items } = readiness;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-label">What we can check</p>
          {percent === null ? (
            <p className="text-data text-sm text-muted">Nothing to check yet</p>
          ) : (
            <p className="text-data text-2xl text-ivory">
              {readyCount}
              <span className="text-muted">/{checkableCount}</span>
            </p>
          )}
        </div>

        {percent !== null ? (
          <div
            role="img"
            aria-label={`${readyCount} of ${checkableCount} checkable items recorded`}
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-indigo-800"
          >
            <div
              className="h-full rounded-full bg-baobab"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}

        {/*
          Load-bearing caveat, not a footnote. Without it the figure reads as
          "you are N% ready to travel", which is not what it measures — it
          measures how much of our own record is in order.
        */}
        {readiness.requirementsUnknown ? (
          <p className="mt-4 flex gap-2 text-sm leading-relaxed text-muted">
            <span aria-hidden="true">◌</span>
            <span>
              This counts what we hold, not whether it meets your
              destination&rsquo;s requirements — we have not verified those.
            </span>
          </p>
        ) : (
          <p className="mt-4 flex gap-2 text-sm leading-relaxed text-muted">
            <span aria-hidden="true">◌</span>
            <span>
              This counts what we hold. Take Me Home is not the authority on
              entry requirements — check the country guide.
            </span>
          </p>
        )}
      </div>

      {nextAction ? (
        <div className="rounded-2xl border border-sunset/40 bg-sunset/10 p-5 sm:p-6">
          <p className="text-label">Next action</p>
          <p className="mt-2 text-base text-ivory">{nextAction.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-ivory/70">
            {nextAction.detail}
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {items.map((item: ReadinessItem) => (
          <li
            key={item.id}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-base text-ivory">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {item.detail}
              </p>
            </div>
            <Badge state={item.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}

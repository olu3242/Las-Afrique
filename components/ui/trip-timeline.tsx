import type { TimelineStage } from "@/lib/dashboard/timeline";
import { RouteMotif } from "@/components/ui/route-motif";

/**
 * The route motif as the trip's timeline.
 *
 * This is the product's one visual idea, grown up: the same origin-to-
 * destination line from the marketing site, now carrying real stage state.
 * The motif is passed `stops={[]}` so it acts as the connector behind these
 * markers rather than competing with them.
 *
 * Status is never carried by position or colour alone — each stage has a
 * glyph and a text label.
 */

const GLYPH: Record<TimelineStage["status"], string> = {
  done: "✓",
  current: "●",
  todo: "○",
};

const TONE: Record<TimelineStage["status"], string> = {
  done: "text-baobab-light",
  current: "text-sunset",
  todo: "text-muted",
};

const STATUS_LABEL: Record<TimelineStage["status"], string> = {
  done: "Done",
  current: "In progress",
  todo: "Not started",
};

export function TripTimeline({ stages }: { stages: TimelineStage[] }) {
  return (
    <div>
      <div aria-hidden="true" className="h-4 w-full text-sunset">
        <RouteMotif animated={false} stops={[]} />
      </div>

      {/*
        Named, not anonymous. A screen reader announcing "list, 4 items" beside
        three other panels is not much help, and the name also makes the
        stages addressable — the title is a bare text node between a glyph and
        an sr-only status, so nothing else identifies them.
      */}
      <ol
        aria-label="Trip timeline"
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {stages.map((stage) => (
          <li
            key={stage.id}
            className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-4 py-3.5"
          >
            <p className="flex items-center gap-2 text-sm text-ivory">
              <span aria-hidden="true" className={TONE[stage.status]}>
                {GLYPH[stage.status]}
              </span>
              {stage.title}
              <span className="sr-only"> — {STATUS_LABEL[stage.status]}</span>
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {stage.detail}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

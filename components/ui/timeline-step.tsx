import type { JourneyStep } from "@/lib/readiness";

interface TimelineStepProps {
  step: JourneyStep;
  index: number;
}

const STATUS_META: Record<
  JourneyStep["status"],
  { label: string; glyph: string; dot: string; text: string }
> = {
  done: { label: "Done", glyph: "✓", dot: "bg-baobab border-baobab", text: "text-baobab" },
  current: { label: "In progress", glyph: "●", dot: "bg-sunset border-sunset", text: "text-sunset" },
  todo: { label: "Not started", glyph: "○", dot: "bg-indigo-800 border-muted/50", text: "text-muted" },
};

/**
 * One stage of the readiness journey. The same step shape drives the marketing
 * pillars now and the authenticated trip timeline in Phase 1.
 */
export function TimelineStep({ step, index }: TimelineStepProps) {
  const meta = STATUS_META[step.status];

  return (
    <li className="relative flex gap-4 sm:block">
      {/* Marker. On mobile the steps stack, so the rail runs vertically. */}
      <div className="flex flex-col items-center sm:block">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[0.625rem] text-indigo-950 ${meta.dot}`}
        >
          {meta.glyph}
        </span>
        <span className="mt-2 w-px grow bg-ivory/15 sm:hidden" />
      </div>

      <div className="pb-8 sm:pb-0 sm:pt-5">
        <p className="text-label">
          Step {index + 1} · <span className={meta.text}>{meta.label}</span>
        </p>
        <h3 className="mt-2 font-display text-xl text-ivory">{step.title}</h3>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ivory/65">
          {step.description}
        </p>
      </div>
    </li>
  );
}

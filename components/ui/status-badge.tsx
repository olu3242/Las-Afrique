import { READINESS_STATES, type ReadinessState } from "@/lib/readiness";

interface StatusBadgeProps {
  state: ReadinessState;
  /** Overrides the default state label where a more specific word reads better. */
  label?: string;
}

/**
 * State is carried by the glyph and the words, not the colour. Colour is a third,
 * redundant signal — the badge still reads correctly in greyscale.
 */
export function StatusBadge({ state, label }: StatusBadgeProps) {
  const meta = READINESS_STATES[state];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] ${meta.className}`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {label ?? meta.label}
    </span>
  );
}

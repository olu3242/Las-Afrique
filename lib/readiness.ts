/**
 * Shared vocabulary for readiness state.
 *
 * State is never communicated by colour alone: every state carries a glyph and a
 * text label so it survives greyscale, colour-blindness and screen readers.
 */

export type ReadinessState =
  | "ready"
  | "action-needed"
  | "upcoming"
  | "missing"
  | "expiring";

export interface ReadinessStateMeta {
  /** Short label rendered next to the glyph. */
  label: string;
  /** Non-colour carrier of state. Decorative in the DOM; the label does the talking. */
  glyph: string;
  /** Tailwind classes for the badge surface. */
  className: string;
}

export const READINESS_STATES: Record<ReadinessState, ReadinessStateMeta> = {
  ready: {
    label: "Ready",
    glyph: "✓",
    className: "border-baobab/40 bg-baobab/15 text-baobab-light",
  },
  "action-needed": {
    label: "Action needed",
    glyph: "!",
    className: "border-sunset/50 bg-sunset/15 text-sunset",
  },
  upcoming: {
    label: "Upcoming",
    glyph: "→",
    className: "border-muted/40 bg-muted/10 text-muted",
  },
  missing: {
    label: "Missing",
    glyph: "×",
    className: "border-ivory/25 bg-ivory/5 text-ivory/70",
  },
  expiring: {
    label: "Expiring",
    glyph: "◷",
    className: "border-sunset/50 bg-sunset/15 text-sunset",
  },
};

/** Journey stages. Mirrors the four public pillars and the future trip timeline. */
export type JourneyStage = "plan" | "prepare" | "budget" | "go-home";

export interface JourneyStep {
  id: JourneyStage;
  title: string;
  description: string;
  /** Whether the traveller has reached, is working through, or has yet to start this stage. */
  status: "done" | "current" | "todo";
}

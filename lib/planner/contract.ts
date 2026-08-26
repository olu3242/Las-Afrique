/**
 * The planner's contract.
 *
 * The architecture principle this exists to enforce, from the PRD:
 *
 *   Cost Engine          → the numerical source of truth
 *   Country Data Service → the compliance source of truth
 *   AI                   → planner and explainer, never a source of truth
 *
 * So a plan is a *structure of references*, not a piece of prose that happens
 * to contain numbers. Every figure a plan shows must point at a value some
 * engine computed, and the verifier refuses anything that does not.
 */

export interface ToolFigure {
  /** Stable id the plan refers to, e.g. "budget.planningTarget". */
  ref: string;
  /** The authoritative value. The plan may show it; it may not restate it. */
  value: number;
  currency: string;
  label: string;
}

export interface ToolFact {
  ref: string;
  /** A statement some engine is entitled to make. */
  statement: string;
}

/**
 * Everything the planner is allowed to build a plan out of.
 *
 * Assembled from the real engines. If a figure or fact is not in here, no plan
 * may contain it — that is the whole enforcement mechanism.
 */
export interface PlannerTools {
  tripId: string;
  destinationName: string | null;
  /** False when the Country Data Service has nothing verified for it. */
  destinationVerified: boolean;
  figures: ToolFigure[];
  facts: ToolFact[];
}

export interface PlanStep {
  title: string;
  /** Prose the model wrote. Checked, not trusted. */
  body: string;
  /** Figures this step displays, by ref. Resolved from tools at render time. */
  figureRefs: string[];
  /** Facts this step relies on, by ref. */
  factRefs: string[];
}

export interface TripPlan {
  summary: string;
  steps: PlanStep[];
  /** Which engine snapshot the plan was built against. */
  toolsVersion: string;
}

export const PLANNER_CONTRACT_VERSION = "planner-contract/1.0.0";

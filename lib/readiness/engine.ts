import type { DocumentKind, ReadinessState } from "@/lib/supabase/types";

/**
 * The travel readiness engine.
 *
 * Deterministic and pure: same inputs, same output, no clock of its own and no
 * database. The consumer derives it on every read, so it recomputes by
 * construction rather than by anyone remembering to invalidate a cache.
 *
 * The line this engine will not cross
 * -----------------------------------
 * There are two different questions, and only one of them can be answered here:
 *
 *   "Do we have the information?"        — answerable. It is our own record.
 *   "Does it satisfy the destination?"   — not answerable without a verified
 *                                          source for that destination.
 *
 * So readiness measures the first and reports the second as explicitly
 * unknown. `ready` means *recorded and free of mechanical conflict* — never
 * "meets the requirements", which this engine is not entitled to say.
 *
 * Everything it does assert is arithmetic on data the traveller gave us: a
 * passport that expired, or that expires before the trip returns, is a fact
 * about two dates. It is not a claim about immigration policy, and the copy
 * never phrases it as one. "Six months' validity" and its cousins are real
 * requirements in many places and invented ones in others; this engine states
 * neither.
 */

export interface ReadinessTraveler {
  id: string;
  fullName: string;
  passportExpiresOn: string | null;
}

export interface ReadinessDocument {
  id: string;
  travelerId: string | null;
  kind: DocumentKind;
  state: ReadinessState;
  dueOn: string | null;
  note: string | null;
}

export interface ReadinessInput {
  departOn: string | null;
  returnOn: string | null;
  /** Display name of the destination, for copy. Null when none is set. */
  destinationName: string | null;
  /** Whether the Country Data Service has a verified guide for it. */
  destinationVerified: boolean;
  travelers: ReadinessTraveler[];
  documents: ReadinessDocument[];
  /** Today as an ISO date. Injected so the rules are testable without clocks. */
  today: string;
}

export interface ReadinessItem {
  id: string;
  travelerId: string | null;
  travelerName: string | null;
  kind: DocumentKind | "destination";
  state: ReadinessState;
  title: string;
  /** Plain language, never phrased as legal or immigration advice. */
  detail: string;
  dueOn: string | null;
}

export interface Readiness {
  items: ReadinessItem[];
  counts: Record<ReadinessState, number>;
  /** Items this engine is entitled to judge — the denominator for `percent`. */
  checkableCount: number;
  readyCount: number;
  /** Null when there is nothing checkable, rather than a misleading 0 or 100. */
  percent: number | null;
  nextAction: ReadinessItem | null;
  /**
   * True when the destination has no verified guide, so no item's requirement
   * satisfaction is known. Consumers must surface this next to any figure —
   * a percentage without it reads as "you are 80% ready to travel", which is
   * not what it measures.
   */
  requirementsUnknown: boolean;
}

/**
 * Ordering for "what should I do next".
 *
 * Lower sorts first. `verify_required` deliberately outranks `missing`: being
 * told what a country requires changes which missing things matter, so it is
 * the more useful next step.
 */
const URGENCY: Record<ReadinessState, number> = {
  action_needed: 0,
  expiring: 1,
  verify_required: 2,
  missing: 3,
  upcoming: 4,
  ready: 5,
};

/** States this engine can genuinely judge, and so may count towards a figure. */
const CHECKABLE: ReadinessState[] = [
  "ready",
  "action_needed",
  "expiring",
  "missing",
];

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function deriveReadiness(input: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [];

  // ---- the destination itself -------------------------------------------
  // First, because it governs how much anything else can be trusted.
  if (input.destinationName) {
    items.push(
      input.destinationVerified
        ? {
            id: "destination",
            travelerId: null,
            travelerName: null,
            kind: "destination",
            state: "verify_required",
            title: `Entry requirements for ${input.destinationName}`,
            detail:
              "We have a verified guide, but Take Me Home is not the " +
              "authority on entry requirements. Check the source before you " +
              "book anything.",
            dueOn: null,
          }
        : {
            id: "destination",
            travelerId: null,
            travelerName: null,
            kind: "destination",
            state: "verify_required",
            title: `Entry requirements for ${input.destinationName}`,
            detail:
              `We have not verified what ${input.destinationName} requires ` +
              "of travellers, so nothing below is checked against its rules.",
            dueOn: null,
          },
    );
  }

  // ---- passports ---------------------------------------------------------
  // The comparison date is the last day the traveller is away. Without a
  // return date, departure is the only fact available.
  const lastDay = input.returnOn ?? input.departOn;

  for (const traveler of input.travelers) {
    const base = {
      id: `passport-${traveler.id}`,
      travelerId: traveler.id,
      travelerName: traveler.fullName,
      kind: "passport" as const,
    };

    if (!traveler.passportExpiresOn) {
      items.push({
        ...base,
        state: "missing",
        title: `Passport expiry for ${traveler.fullName}`,
        detail:
          "We do not have an expiry date, so we cannot check it against " +
          "this trip's dates.",
        dueOn: null,
      });
      continue;
    }

    const expires = traveler.passportExpiresOn;

    if (expires < input.today) {
      items.push({
        ...base,
        state: "action_needed",
        title: `${traveler.fullName}'s passport has expired`,
        detail: `It expired on ${formatDate(expires)}.`,
        dueOn: expires,
      });
      continue;
    }

    if (lastDay && expires < lastDay) {
      items.push({
        ...base,
        state: "action_needed",
        title: `${traveler.fullName}'s passport expires during this trip`,
        detail:
          `It expires on ${formatDate(expires)}, before the trip ends on ` +
          `${formatDate(lastDay)}.`,
        dueOn: expires,
      });
      continue;
    }

    // Valid for the whole trip, as far as arithmetic goes. Deliberately not
    // called "ready to travel": many destinations require validity for a
    // period beyond the return date, and this engine does not know which.
    items.push({
      ...base,
      state: "ready",
      title: `Passport recorded for ${traveler.fullName}`,
      detail:
        `Valid until ${formatDate(expires)}, which covers the trip. ` +
        "Some destinations require validity beyond your return date — check " +
        "the country guide.",
      dueOn: expires,
    });
  }

  // ---- documents the traveller has recorded ------------------------------
  for (const doc of input.documents) {
    const traveler = input.travelers.find((t) => t.id === doc.travelerId);
    items.push({
      id: `document-${doc.id}`,
      travelerId: doc.travelerId,
      travelerName: traveler?.fullName ?? null,
      kind: doc.kind,
      // The stored state is the user's own record of where the document
      // stands. The engine does not overrule it; it has no basis to.
      state: doc.state,
      title: documentTitle(doc.kind, traveler?.fullName ?? null),
      detail: doc.note ?? "Recorded on this trip.",
      dueOn: doc.dueOn,
    });
  }

  // ---- summary -----------------------------------------------------------
  const counts = items.reduce(
    (acc, item) => {
      acc[item.state] += 1;
      return acc;
    },
    {
      ready: 0,
      action_needed: 0,
      upcoming: 0,
      missing: 0,
      expiring: 0,
      verify_required: 0,
    } as Record<ReadinessState, number>,
  );

  const checkableCount = CHECKABLE.reduce((sum, s) => sum + counts[s], 0);
  const readyCount = counts.ready;

  const sorted = [...items].sort((a, b) => {
    const byUrgency = URGENCY[a.state] - URGENCY[b.state];
    if (byUrgency !== 0) return byUrgency;
    // Within a state, the nearest deadline first; undated last.
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return a.title.localeCompare(b.title);
  });

  const nextAction = sorted.find((item) => item.state !== "ready") ?? null;

  return {
    items: sorted,
    counts,
    checkableCount,
    readyCount,
    percent:
      checkableCount === 0
        ? null
        : Math.round((readyCount / checkableCount) * 100),
    nextAction,
    requirementsUnknown: !input.destinationVerified,
  };
}

function documentTitle(kind: DocumentKind, who: string | null): string {
  const labels: Record<DocumentKind, string> = {
    passport: "Passport",
    visa: "Visa",
    entry_permit: "Entry permit",
    travel_health_record: "Travel health record",
    return_ticket: "Return ticket",
    proof_of_accommodation: "Proof of accommodation",
    travel_insurance: "Travel insurance",
    other: "Document",
  };
  return who ? `${labels[kind]} for ${who}` : labels[kind];
}

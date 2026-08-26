/**
 * ILLUSTRATIVE DATA — Phase 0 only.
 *
 * Everything in this file is an example used to demonstrate the shape of the
 * product on the marketing site. None of it is live user data, and none of it is
 * an authoritative statement about any country's entry requirements.
 *
 * Phase 1 replaces these constants with real sources:
 *   - trip / documents  -> user record
 *   - budget            -> deterministic Cost Estimation Engine
 *   - countries         -> Country Data Service
 *
 * Component props are modelled on the eventual engine responses, so the swap is a
 * data-source change rather than a redesign.
 */

import type { JourneyStep, ReadinessState } from "./readiness";

export const IS_ILLUSTRATIVE = true;

/* -------------------------------------------------------------------------- */
/* Trip                                                                        */
/* -------------------------------------------------------------------------- */

export interface TripSummaryData {
  city: string;
  country: string;
  window: string;
  readinessPercent: number;
  daysUntilDeparture: number;
  travellers: number;
}

export const EXAMPLE_TRIP: TripSummaryData = {
  city: "Lagos",
  country: "Nigeria",
  window: "December Homecoming",
  readinessPercent: 72,
  daysUntilDeparture: 112,
  travellers: 3,
};

export const EXAMPLE_NEXT_ACTION = {
  label: "Renew passport",
  detail: "Your passport expires inside the six-month window some airlines check.",
  due: "Start by 12 September",
} as const;

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export interface DocumentItem {
  id: string;
  name: string;
  /** Which traveller this belongs to, or "All travellers". */
  owner: string;
  state: ReadinessState;
  /** Plain-language status. Never phrased as legal or medical advice. */
  note: string;
}

/** Five of seven ready — matches the readiness figure shown in the hero. */
export const EXAMPLE_DOCUMENTS: DocumentItem[] = [
  {
    id: "passport-adaeze",
    name: "Passport",
    owner: "Adaeze",
    state: "expiring",
    note: "Expires within six months of the travel date. Renewal takes time — start early.",
  },
  {
    id: "passport-household",
    name: "Passport",
    owner: "Chidi and Ngozi",
    state: "ready",
    note: "Valid well past the travel window.",
  },
  {
    id: "entry-permit",
    name: "Entry permit or visa",
    owner: "All travellers",
    state: "action-needed",
    note: "Requirements depend on your passport. Check the country guide before you book.",
  },
  {
    id: "vaccination",
    name: "Travel health record",
    owner: "All travellers",
    state: "ready",
    note: "On file. Some destinations ask for proof on arrival — confirm with a clinician.",
  },
  {
    id: "return-ticket",
    name: "Return ticket",
    owner: "All travellers",
    state: "ready",
    note: "Booked and stored in your vault.",
  },
  {
    id: "accommodation",
    name: "Proof of accommodation",
    owner: "All travellers",
    state: "ready",
    note: "Family address on file.",
  },
  {
    id: "insurance",
    name: "Travel insurance",
    owner: "All travellers",
    state: "ready",
    note: "Cover runs through the full trip.",
  },
];

export const DOCUMENTS_READY_COUNT = EXAMPLE_DOCUMENTS.filter(
  (doc) => doc.state === "ready",
).length;

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

export interface BudgetCategory {
  id: string;
  label: string;
  /** Low end of the estimated range, in whole dollars. */
  low: number;
  /** High end of the estimated range, in whole dollars. */
  high: number;
  /** The planning figure the engine recommends budgeting against. */
  target: number;
}

/**
 * Category figures come from the deterministic engine, not from a language model.
 * Targets sum to the planning target; lows and highs sum to the range endpoints.
 */
export const EXAMPLE_BUDGET: BudgetCategory[] = [
  { id: "flights", label: "Flights", low: 2970, high: 3330, target: 3150 },
  { id: "accommodation", label: "Accommodation", low: 1130, high: 1270, target: 1200 },
  { id: "food", label: "Food", low: 540, high: 620, target: 580 },
  { id: "transport", label: "Local transportation", low: 355, high: 405, target: 380 },
  { id: "documents", label: "Visa and documents", low: 270, high: 290, target: 280 },
  { id: "insurance", label: "Travel insurance", low: 140, high: 150, target: 145 },
  { id: "activities", label: "Activities", low: 400, high: 460, target: 430 },
  { id: "family", label: "Family and shopping", low: 1625, high: 1675, target: 1650 },
  { id: "contingency", label: "Contingency", low: 370, high: 400, target: 385 },
];

export const EXAMPLE_BUDGET_TOTALS = {
  low: EXAMPLE_BUDGET.reduce((sum, item) => sum + item.low, 0),
  high: EXAMPLE_BUDGET.reduce((sum, item) => sum + item.high, 0),
  target: EXAMPLE_BUDGET.reduce((sum, item) => sum + item.target, 0),
};

export const EXAMPLE_SAVINGS = {
  saved: 6480,
  monthsRemaining: 4,
};

export const EXAMPLE_ASSUMPTIONS = [
  "Three travellers, economy fares booked eleven weeks out",
  "Two weeks in country, staying with family for nine nights",
  "Peak December demand applied to flights and accommodation",
] as const;

/** How much the engine trusts this estimate, given how much the traveller has told it. */
export const EXAMPLE_CONFIDENCE = {
  level: "Medium",
  reason: "Dates and travellers are set. Accommodation split is still an estimate.",
} as const;

/* -------------------------------------------------------------------------- */
/* Countries                                                                   */
/* -------------------------------------------------------------------------- */

export interface CountryInsightData {
  id: string;
  name: string;
  /** ISO 4217 code. Factual reference only. */
  currency: string;
  cities: string[];
  /** Relative freshness of the country guide, shown so travellers can judge it. */
  lastChecked: string;
}

/**
 * The eleven launch countries, in the order the PRD defines.
 * Nigeria is the primary example throughout the product.
 *
 * These records deliberately carry no entry, visa or health requirements. Those
 * come from the Country Data Service in Phase 1, with a source and a checked date
 * attached. The marketing site says a guide exists; it does not state the rules.
 */
export const LAUNCH_COUNTRIES: CountryInsightData[] = [
  { id: "nigeria", name: "Nigeria", currency: "NGN", cities: ["Lagos", "Abuja", "Port Harcourt"], lastChecked: "6 days ago" },
  { id: "ghana", name: "Ghana", currency: "GHS", cities: ["Accra", "Kumasi", "Takoradi"], lastChecked: "6 days ago" },
  { id: "kenya", name: "Kenya", currency: "KES", cities: ["Nairobi", "Mombasa", "Kisumu"], lastChecked: "9 days ago" },
  { id: "uganda", name: "Uganda", currency: "UGX", cities: ["Kampala", "Entebbe", "Gulu"], lastChecked: "9 days ago" },
  { id: "south-africa", name: "South Africa", currency: "ZAR", cities: ["Johannesburg", "Cape Town", "Durban"], lastChecked: "4 days ago" },
  { id: "liberia", name: "Liberia", currency: "LRD", cities: ["Monrovia", "Gbarnga", "Buchanan"], lastChecked: "12 days ago" },
  { id: "cameroon", name: "Cameroon", currency: "XAF", cities: ["Douala", "Yaoundé", "Bafoussam"], lastChecked: "12 days ago" },
  { id: "sierra-leone", name: "Sierra Leone", currency: "SLE", cities: ["Freetown", "Bo", "Kenema"], lastChecked: "14 days ago" },
  { id: "senegal", name: "Senegal", currency: "XOF", cities: ["Dakar", "Thiès", "Saint-Louis"], lastChecked: "8 days ago" },
  { id: "ivory-coast", name: "Ivory Coast", currency: "XOF", cities: ["Abidjan", "Yamoussoukro", "Bouaké"], lastChecked: "8 days ago" },
  { id: "ethiopia", name: "Ethiopia", currency: "ETB", cities: ["Addis Ababa", "Dire Dawa", "Bahir Dar"], lastChecked: "5 days ago" },
];

/* -------------------------------------------------------------------------- */
/* Journey                                                                     */
/* -------------------------------------------------------------------------- */

export const JOURNEY_STEPS: JourneyStep[] = [
  {
    id: "plan",
    title: "Plan",
    description: "Tell us where, when and who's travelling.",
    status: "done",
  },
  {
    id: "prepare",
    title: "Prepare",
    description: "Understand passport, visa, document and deadline requirements.",
    status: "current",
  },
  {
    id: "budget",
    title: "Budget",
    description: "See the estimated cost and what to save.",
    status: "todo",
  },
  {
    id: "go-home",
    title: "Go home",
    description: "Follow the readiness timeline toward departure.",
    status: "todo",
  },
];

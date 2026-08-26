/**
 * Database types.
 *
 * Hand-maintained to match `supabase/migrations/`. Once a Supabase project
 * exists these can be generated with `supabase gen types typescript`; until then
 * the schema test in `tests/schema.test.ts` asserts the table and column set
 * here matches what the migrations actually create, so drift fails CI rather
 * than surfacing at runtime.
 */

export type TripPurpose =
  | "homecoming"
  | "family_visit"
  | "ceremony"
  | "business"
  | "other";

export type TripStatus =
  | "draft"
  | "planning"
  | "ready"
  | "travelled"
  | "cancelled";

export type ReadinessState =
  | "ready"
  | "action_needed"
  | "upcoming"
  | "missing"
  | "expiring"
  | "verify_required";

export type DocumentKind =
  | "passport"
  | "visa"
  | "entry_permit"
  | "travel_health_record"
  | "return_ticket"
  | "proof_of_accommodation"
  | "travel_insurance"
  | "other";

export type AccommodationTier =
  | "staying_with_family"
  | "budget"
  | "midrange"
  | "premium";

export type VerificationState = "unverified" | "verified" | "stale";

export type CostCategory =
  | "flights"
  | "accommodation"
  | "food"
  | "local_transport"
  | "visa_and_documents"
  | "travel_insurance"
  | "activities"
  | "family_and_shopping"
  | "contingency";

export type CostUnit =
  | "per_person_per_trip"
  | "per_person_per_night"
  | "per_trip"
  | "percent_of_subtotal";

/**
 * Whether a rate is a planning placeholder or something with a source behind
 * it. Every figure derived from an `illustrative` rate must say so on screen.
 */
export type AssumptionBasis = "illustrative" | "verified";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  home_country: string | null;
  home_currency: string | null;
  created_at: string;
  updated_at: string;
}

export interface CountryProfileRow {
  key: string;
  name: string;
  currency: string;
  sort_order: number;
  major_cities: string[];
  visa_entry_info: unknown | null;
  passport_considerations: unknown | null;
  emergency_info: unknown | null;
  customs_notes: unknown | null;
  advisories: unknown | null;
  source_name: string | null;
  source_url: string | null;
  last_verified_at: string | null;
  verification_state: VerificationState;
  data_version: number;
  created_at: string;
  updated_at: string;
}

export interface CostAssumptionRow {
  id: string;
  /** Null applies to any destination without its own rate for the category. */
  country_key: string | null;
  category: CostCategory;
  unit: CostUnit;
  currency: string;
  amount_low: number;
  amount_high: number;
  basis: AssumptionBasis;
  note: string | null;
  source_name: string | null;
  source_url: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripRow {
  id: string;
  user_id: string;
  origin_country: string | null;
  origin_city: string | null;
  destination_country_key: string | null;
  destination_city: string | null;
  depart_on: string | null;
  return_on: string | null;
  purpose: TripPurpose | null;
  party_size: number | null;
  accommodation_tier: AccommodationTier | null;
  status: TripStatus;
  created_at: string;
  updated_at: string;
}

export interface TravelerRow {
  id: string;
  trip_id: string;
  user_id: string;
  full_name: string;
  relationship: string | null;
  is_primary: boolean;
  passport_last4: string | null;
  passport_expires_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecordRow {
  id: string;
  trip_id: string;
  traveler_id: string | null;
  user_id: string;
  kind: DocumentKind;
  state: ReadinessState;
  due_on: string | null;
  note: string | null;
  source_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostEstimateRow {
  id: string;
  trip_id: string;
  user_id: string;
  currency: string;
  estimate_low: number | null;
  estimate_high: number | null;
  planning_target: number | null;
  categories: unknown;
  assumptions: unknown;
  confidence: string | null;
  engine_version: string;
  computed_at: string;
  created_at: string;
}

export interface SavingsPlanRow {
  id: string;
  trip_id: string;
  user_id: string;
  currency: string;
  target_amount: number | null;
  amount_saved: number;
  monthly_target: number | null;
  months_remaining: number | null;
  created_at: string;
  updated_at: string;
}

export interface VaultFileRow {
  id: string;
  user_id: string;
  trip_id: string | null;
  traveler_id: string | null;
  document_record_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
  updated_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      country_profiles: Table<CountryProfileRow>;
      cost_assumptions: Table<CostAssumptionRow>;
      trips: Table<TripRow>;
      travelers: Table<TravelerRow>;
      document_records: Table<DocumentRecordRow>;
      cost_estimates: Table<CostEstimateRow>;
      savings_plans: Table<SavingsPlanRow>;
      vault_files: Table<VaultFileRow>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      trip_purpose: TripPurpose;
      trip_status: TripStatus;
      readiness_state: ReadinessState;
      document_kind: DocumentKind;
      accommodation_tier: AccommodationTier;
      verification_state: VerificationState;
      cost_category: CostCategory;
      cost_unit: CostUnit;
      assumption_basis: AssumptionBasis;
    };
  };
}

/** Tables that carry per-user ownership and must be protected by RLS. */
export const TENANT_TABLES = [
  "profiles",
  "trips",
  "travelers",
  "document_records",
  "cost_estimates",
  "savings_plans",
  "vault_files",
] as const;

/** Tables that are public reference data rather than tenant-scoped. */
export const REFERENCE_TABLES = [
  "country_profiles",
  "cost_assumptions",
] as const;

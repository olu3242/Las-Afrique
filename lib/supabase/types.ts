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

/** The only member state a group ever sees. Never the underlying record. */
export type MemberCoordinationState =
  | "ready"
  | "action_required"
  | "blocked"
  | "optional"
  | "complete";

export type GroupRole = "owner" | "coordinator" | "member";

export type GroupMemberState = "active" | "left" | "removed";

export type GroupInvitationState =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export type GroupTaskState = "open" | "blocked" | "done";

export type GroupParticipationState = "in" | "out" | "undecided";

export type VerificationState = "unverified" | "verified" | "stale";

export type ReminderChannel = "email" | "push" | "in_app";

export type ReminderStatus = "pending" | "sent" | "failed" | "cancelled";

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

export interface ReminderRow {
  id: string;
  user_id: string;
  trip_id: string | null;
  subject: string;
  body: string;
  channel: ReminderChannel;
  due_at: string;
  status: ReminderStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  /** Stable for a given deadline, so a job that runs twice sends once. */
  dedupe_key: string;
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
      reminders: Table<ReminderRow>;
      referral_programs: Table<ReferralProgramRow>;
      referral_codes: Table<ReferralCodeRow>;
      referral_invitations: Table<ReferralInvitationRow>;
      referrals: Table<ReferralRow>;
      reward_entitlements: Table<RewardEntitlementRow>;
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
      reminder_channel: ReminderChannel;
      reminder_status: ReminderStatus;
      referral_state: ReferralState;
      referral_invitation_state: ReferralInvitationState;
      referral_qualification_predicate: ReferralQualificationPredicate;
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
  "reminders",
  // Iteration 12. These obey the same single-owner rule as everything above —
  // `user_id = auth.uid()`, all four verbs, `with check` alongside `using` —
  // so they are asserted by the same certified checks rather than by a new
  // list that would have to re-prove the same properties.
  "referral_codes",
  "referral_invitations",
  "reward_entitlements",
] as const;

/** Tables that are public reference data rather than tenant-scoped. */
export const REFERENCE_TABLES = [
  "country_profiles",
  "cost_assumptions",
  "referral_programs",
] as const;

// ---------------------------------------------------------------------------
// Group coordination (Iteration 11)
//
// These tables are tenant data, but not under the single-owner rule the tables
// above follow. Their access model is membership: a row is readable by anyone
// with an active membership in its group, and writable according to that
// member's role. That is a different invariant, so it is asserted separately
// rather than by widening TENANT_TABLES — see GROUP_TABLES below.
// ---------------------------------------------------------------------------

export interface TravelGroupRow {
  id: string;
  owner_id: string;
  name: string;
  destination_country_key: string | null;
  depart_on: string | null;
  return_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupMembershipRow {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  state: GroupMemberState;
  /** MEMBER_SHARED_WITH_GROUP. Written by the member, read by the group. */
  display_name: string | null;
  arrival_on: string | null;
  departure_on: string | null;
  /** Governs SYSTEM_DERIVED_GROUP_STATUS. False until the member opts in. */
  shares_readiness: boolean;
  /**
   * SYSTEM_DERIVED_GROUP_STATUS. One coarse word the member derived from their
   * own records; null when nothing is published. Cleared on opt-out.
   */
  coordination_state: MemberCoordinationState | null;
  joined_at: string;
  updated_at: string;
}

export interface GroupInvitationRow {
  id: string;
  group_id: string;
  email: string;
  role: GroupRole;
  /** Hashed. The plaintext token exists only in the invitation link. */
  token_hash: string;
  state: GroupInvitationState;
  invited_by: string;
  accepted_by: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface GroupTripRow {
  id: string;
  group_id: string;
  trip_id: string;
  user_id: string;
  created_at: string;
}

export interface GroupTaskRow {
  id: string;
  group_id: string;
  title: string;
  detail: string | null;
  due_on: string | null;
  state: GroupTaskState;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GroupTaskAssignmentRow {
  id: string;
  group_id: string;
  task_id: string;
  assignee_id: string;
  completed_at: string | null;
  created_at: string;
}

export interface GroupActivityRow {
  id: string;
  group_id: string;
  title: string;
  detail: string | null;
  happens_on: string | null;
  location: string | null;
  /** Coordination only. Nothing here is held, transferred or settled. */
  estimated_cost: string | null;
  cost_currency: string | null;
  booking_owner_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GroupActivityParticipationRow {
  id: string;
  group_id: string;
  activity_id: string;
  user_id: string;
  state: GroupParticipationState;
  updated_at: string;
}

export interface GroupDependencyRow {
  id: string;
  group_id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

/**
 * The group root. Scoped by `owner_id` for write and by membership for read,
 * so it carries no `group_id` of its own — its `id` is the group id.
 */
export const GROUP_ROOT_TABLE = "travel_groups" as const;

/**
 * Group-scoped tables. Every one carries `group_id`, enables and forces RLS,
 * and covers all four verbs — but unlike a tenant table it may carry more than
 * one policy per verb, because read is membership-scoped while write is
 * role-scoped. The schema tests iterate this list and assert exactly that.
 */
export const GROUP_TABLES = [
  "group_memberships",
  "group_invitations",
  "group_trips",
  "group_tasks",
  "group_task_assignments",
  "group_activities",
  "group_activity_participation",
  "group_dependencies",
] as const;

// ---------------------------------------------------------------------------
// Referral (Iteration 12)
//
// Three shapes live here, and they are deliberately not one:
//
//   REFERENCE          referral_programs — the rules, versioned, world-readable
//   TENANT             referral_codes, referral_invitations, reward_entitlements
//                      — owner-scoped, the same single-owner rule as everything
//                      in TENANT_TABLES, so they join that list
//   DUAL-PARTY         referrals — readable by the referrer *and* the referred
//                      user, writable by neither. It carries no `user_id`, so
//                      it cannot join TENANT_TABLES without weakening what that
//                      list asserts; it is asserted separately instead.
// ---------------------------------------------------------------------------

/** The states a `referrals` row can actually hold. */
export type ReferralState = "joined" | "qualified" | "disqualified";

export type ReferralInvitationState =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export type ReferralQualificationPredicate =
  | "account_created"
  | "first_trip_created"
  | "first_trip_with_destination_and_dates";

export interface ReferralProgramRow {
  key: string;
  name: string;
  qualification_predicate: ReferralQualificationPredicate;
  attribution_window_days: number;
  invitation_rate_limit_per_day: number;
  /** Names which benefit applies. Never an amount, never a currency. */
  reward_policy_key: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralCodeRow {
  id: string;
  user_id: string;
  program_key: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralInvitationRow {
  id: string;
  user_id: string;
  program_key: string;
  email: string;
  /** Generated. One definition of "the same address", shared with the index. */
  email_normalised: string;
  /** Hashed. The plaintext token exists only in the invitation link. */
  token_hash: string;
  state: ReferralInvitationState;
  accepted_by: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralRow {
  id: string;
  program_key: string;
  referrer_id: string;
  referred_user_id: string;
  invitation_id: string | null;
  state: ReferralState;
  /** Provenance: which string was resolved, and when the touch happened. */
  code: string;
  touched_at: string;
  attributed_at: string;
  qualified_at: string | null;
  disqualified_at: string | null;
  disqualified_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * "Earned under policy X at time T."
 *
 * No amount. No currency. No balance. If a benefit has a monetary value that
 * value belongs to the policy description, outside this engine — never as a
 * liability recorded against a user. PRD §8.
 */
export interface RewardEntitlementRow {
  id: string;
  user_id: string;
  referral_id: string;
  program_key: string;
  reward_policy_key: string;
  earned_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The dual-party table. Named separately because its access model is neither
 * single-owner nor membership-scoped, and folding it into either list would
 * have meant weakening what that list asserts.
 */
export const REFERRAL_DUAL_PARTY_TABLES = ["referrals"] as const;

/** Owner-scoped referral tables, listed for the assertions they share. */
export const REFERRAL_TENANT_TABLES = [
  "referral_codes",
  "referral_invitations",
  "reward_entitlements",
] as const;

/** Reference data added by Iteration 12. */
export const REFERRAL_REFERENCE_TABLES = ["referral_programs"] as const;

import type { FieldErrors } from "@/lib/trips/validation";

/**
 * Group input validation. Pure, and the only place these rules live.
 *
 * Mirrors `lib/trips/validation.ts` deliberately — the server action calls it
 * and the form renders what it returns, so a rule cannot be enforced in one
 * place and forgotten in the other.
 */

export type GroupField = "name" | "destinationCountryKey" | "departOn" | "returnOn";
export type InviteField = "email" | "role";
export type TaskField = "title" | "detail" | "dueOn";
export type ActivityField =
  | "title"
  | "happensOn"
  | "location"
  | "estimatedCost"
  | "costCurrency";
export type MemberField = "displayName" | "arrivalOn" | "departureOn";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A plausible address, checked structurally. Delivery proves the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface GroupInput {
  name: string | null;
  destinationCountryKey: string | null;
  departOn: string | null;
  returnOn: string | null;
}

export function validateGroupInput(
  input: GroupInput,
  countryKeys: readonly string[],
): FieldErrors<GroupField> {
  const errors: FieldErrors<GroupField> = {};

  if (!input.name) {
    errors.name = "Give the group a name.";
  } else if (input.name.length > 120) {
    errors.name = "Keep the name under 120 characters.";
  }

  // A destination we do not recognise is refused rather than resolved to the
  // nearest match — the same rule the country service applies, and for the
  // same reason.
  if (input.destinationCountryKey && !countryKeys.includes(input.destinationCountryKey)) {
    errors.destinationCountryKey = "Choose a destination from the list.";
  }

  for (const [field, value] of [
    ["departOn", input.departOn],
    ["returnOn", input.returnOn],
  ] as const) {
    if (value && !isValidDate(value)) {
      errors[field] = "Use a real date.";
    }
  }

  if (
    input.departOn &&
    input.returnOn &&
    isValidDate(input.departOn) &&
    isValidDate(input.returnOn) &&
    input.returnOn < input.departOn
  ) {
    errors.returnOn = "The return cannot be before the departure.";
  }

  return errors;
}

export function validateInviteInput(input: {
  email: string | null;
  role: string | null;
}): FieldErrors<InviteField> {
  const errors: FieldErrors<InviteField> = {};

  if (!input.email) {
    errors.email = "Enter an email address.";
  } else if (!EMAIL.test(input.email)) {
    errors.email = "That does not look like an email address.";
  }

  // Ownership is not something an invitation can confer. The schema refuses it
  // too; this is so the person sees why rather than a constraint name.
  if (input.role === "owner") {
    errors.role = "An invitation cannot make someone the owner.";
  } else if (input.role && !["coordinator", "member"].includes(input.role)) {
    errors.role = "Choose a role from the list.";
  }

  return errors;
}

export function validateTaskInput(input: {
  title: string | null;
  detail: string | null;
  dueOn: string | null;
}): FieldErrors<TaskField> {
  const errors: FieldErrors<TaskField> = {};

  if (!input.title) {
    errors.title = "Say what needs doing.";
  } else if (input.title.length > 200) {
    errors.title = "Keep the title under 200 characters.";
  }

  if (input.dueOn && !isValidDate(input.dueOn)) {
    errors.dueOn = "Use a real date.";
  }

  return errors;
}

export function validateActivityInput(input: {
  title: string | null;
  happensOn: string | null;
  estimatedCost: string | null;
  costCurrency: string | null;
}): FieldErrors<ActivityField> {
  const errors: FieldErrors<ActivityField> = {};

  if (!input.title) {
    errors.title = "Give the activity a name.";
  } else if (input.title.length > 200) {
    errors.title = "Keep the title under 200 characters.";
  }

  if (input.happensOn && !isValidDate(input.happensOn)) {
    errors.happensOn = "Use a real date.";
  }

  if (input.estimatedCost !== null) {
    const amount = Number(input.estimatedCost);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.estimatedCost = "Enter an amount of zero or more.";
    } else if (!input.costCurrency) {
      // A figure without its currency is not a figure anyone can act on. The
      // schema refuses it; this explains it.
      errors.costCurrency = "Say which currency that is.";
    }
  }

  if (input.costCurrency && !/^[A-Za-z]{3}$/.test(input.costCurrency)) {
    errors.costCurrency = "Use a three-letter currency code.";
  }

  return errors;
}

export function validateMemberInput(input: {
  displayName: string | null;
  arrivalOn: string | null;
  departureOn: string | null;
}): FieldErrors<MemberField> {
  const errors: FieldErrors<MemberField> = {};

  if (input.displayName && input.displayName.length > 120) {
    errors.displayName = "Keep the name under 120 characters.";
  }

  for (const [field, value] of [
    ["arrivalOn", input.arrivalOn],
    ["departureOn", input.departureOn],
  ] as const) {
    if (value && !isValidDate(value)) {
      errors[field] = "Use a real date.";
    }
  }

  if (
    input.arrivalOn &&
    input.departureOn &&
    isValidDate(input.arrivalOn) &&
    isValidDate(input.departureOn) &&
    input.departureOn < input.arrivalOn
  ) {
    errors.departureOn = "You cannot leave before you arrive.";
  }

  return errors;
}

export const GROUP_ROLE_OPTIONS = [
  { value: "coordinator", label: "Coordinator — can shape the plan" },
  { value: "member", label: "Member — can see the plan and their own tasks" },
] as const;

export const PARTICIPATION_OPTIONS = [
  { value: "in", label: "Coming" },
  { value: "out", label: "Not coming" },
  { value: "undecided", label: "Undecided" },
] as const;

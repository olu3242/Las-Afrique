"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { field, type ActionState } from "@/lib/forms";
import { MIN_PASSWORD_LENGTH, safeDestination } from "./policy";

export type AuthField = "email" | "password" | "displayName";

function credentials(form: FormData) {
  const email = field(form, "email");
  // Not trimmed: leading and trailing spaces are legal password characters,
  // and silently stripping them locks a user out of their own account.
  const passwordRaw = form.get("password");
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  return { email, password };
}

export async function signUp(
  _previous: ActionState<AuthField>,
  form: FormData,
): Promise<ActionState<AuthField>> {
  const { email, password } = credentials(form);
  const displayName = field(form, "displayName");
  const next = safeDestination(field(form, "next"));

  const errors: Partial<Record<AuthField, string>> = {};
  if (!email) errors.email = "Enter your email address.";
  if (!password) errors.password = "Choose a password.";
  else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values: { email: email ?? "", displayName: displayName ?? "" } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email as string,
    password,
    // Read by the on_auth_user_created trigger, which writes the profile row.
    // The profile is not created here: a user can also arrive through the admin
    // API, and a profile that depends on this code path would miss them.
    options: { data: displayName ? { display_name: displayName } : undefined },
  });

  if (error) {
    return {
      status: "error",
      message: error.message,
      values: { email: email ?? "", displayName: displayName ?? "" },
    };
  }

  // A project with email confirmation on returns a user but no session. Saying
  // "check your inbox" when no mail was sent would be a lie, and so would
  // sending them to a dashboard they cannot load.
  if (!data.session) {
    return {
      status: "error",
      message:
        "Your account was created. Confirm your email address, then sign in.",
      values: { email: email ?? "", displayName: displayName ?? "" },
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signIn(
  _previous: ActionState<AuthField>,
  form: FormData,
): Promise<ActionState<AuthField>> {
  const { email, password } = credentials(form);
  const next = safeDestination(field(form, "next"));

  const errors: Partial<Record<AuthField, string>> = {};
  if (!email) errors.email = "Enter your email address.";
  if (!password) errors.password = "Enter your password.";

  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values: { email: email ?? "" } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email as string,
    password,
  });

  if (error) {
    // Deliberately not "no account with that address". Distinguishing a wrong
    // password from an unknown address tells an attacker which addresses are
    // registered.
    return {
      status: "error",
      message: "That email address and password do not match an account.",
      values: { email: email ?? "" },
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

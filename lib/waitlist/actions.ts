"use server";

import { createClient } from "@/lib/supabase/server";
import { field } from "@/lib/forms";
import { isSupabaseConfigured } from "@/lib/env";

export type WaitlistState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string; email?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinWaitlist(
  _previous: WaitlistState,
  form: FormData,
): Promise<WaitlistState> {
  const email = field(form, "email")?.toLowerCase() ?? "";

  if (!EMAIL.test(email) || email.length > 254) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      email,
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Early access signup is temporarily unavailable. Please try again soon.",
      email,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waitlist_signups")
    .insert({ email, source: "marketing-site" });

  // Unique-violation and success intentionally have the same response. A
  // visitor should not be able to discover who is already on the list.
  if (!error || error.code === "23505") return { status: "success" };

  return {
    status: "error",
    message: "We couldn't save your address. Please try again.",
    email,
  };
}

import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { AuthUnavailable } from "../unavailable";
import { safeDestination } from "@/lib/auth/policy";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in — Take Me Home",
};

/** Reads the caller's session, so it cannot be prerendered. */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeDestination(params.next);

  // Checked before the client is built: `createClient` throws without
  // configuration, and a thrown 500 is not how an auth gate should say
  // "unavailable".
  if (!isSupabaseConfigured()) return <AuthUnavailable action="Sign in" />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already signed in — sending them to a sign-in form would be a dead end.
  if (user) redirect(next);

  return (
    <>
      <h1 className="font-display text-3xl text-ivory">Sign in</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {params.reason === "required"
          ? "Sign in to reach that page."
          : "Pick up your trip where you left it."}
      </p>

      <SignInForm next={next} />

      <p className="mt-8 text-sm text-muted">
        No account yet?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="inline-block py-1 text-ivory underline decoration-sunset underline-offset-4"
        >
          Create one
        </Link>
        .
      </p>
    </>
  );
}

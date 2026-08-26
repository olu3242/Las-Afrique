import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { AuthUnavailable } from "../unavailable";
import { safeDestination } from "@/lib/auth/policy";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create an account — Take Me Home",
};

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeDestination(params.next);

  // Checked before the client is built: `createClient` throws without
  // configuration, and a thrown 500 is not how an auth gate should say
  // "unavailable".
  if (!isSupabaseConfigured()) return <AuthUnavailable action="Create an account" />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect(next);

  return (
    <>
      <h1 className="font-display text-3xl text-ivory">Create an account</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        One account holds your trip, your travellers and your documents.
      </p>

      <SignUpForm next={next} />

      <p className="mt-8 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="inline-block py-1 text-ivory underline decoration-sunset underline-offset-4"
        >
          Sign in
        </Link>
        .
      </p>
    </>
  );
}

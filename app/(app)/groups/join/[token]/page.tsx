import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { acceptInvitation } from "@/lib/groups/actions";

export const metadata: Metadata = { title: "Join a group — Take Me Home" };

export const dynamic = "force-dynamic";

/**
 * Accepting an invitation link.
 *
 * The route is gated in middleware, so an invitee who is signed out is sent to
 * sign in and returned here afterwards — the membership belongs to a specific
 * user, so there is no meaningful "accept anonymously".
 *
 * Acceptance runs through a security-definer function rather than a read: no
 * policy grants an invitee sight of the invitations table, and none should.
 * The token is the authorization.
 */
export default async function JoinGroupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const outcome = await acceptInvitation(token);

  // Joining and already-being-a-member both end in the same place. A
  // double-clicked link should land the person in the group, not on an error.
  if (outcome.status !== "invalid") {
    redirect(`/groups/${outcome.groupId}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">Invitation</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        That invitation cannot be used
      </h1>
      <p className="mt-5 text-base leading-relaxed text-ivory/70">
        It may have expired, been withdrawn, or already been used. Ask whoever
        invited you to send a new one.
      </p>

      <Link
        href="/groups"
        className="mt-8 inline-flex items-center justify-center rounded-full border border-ivory/25 px-6 py-3 text-sm text-ivory transition-colors hover:border-ivory/50"
      >
        Your groups
      </Link>
    </div>
  );
}

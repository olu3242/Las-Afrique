import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGroup } from "@/lib/groups/service";
import { can } from "@/lib/groups/roles";
import { GroupReadinessPanel } from "@/components/ui/group-readiness-panel";
import { RouteMotif } from "@/components/ui/route-motif";
import { MemberList } from "./member-list";
import { TaskBoard } from "./task-board";
import { ActivityBoard } from "./activity-board";
import { OwnMembershipForm } from "./own-membership-form";
import { LinkTripForm } from "./link-trip-form";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getGroup(id);
  if (!detail) return { title: "Group not found — Take Me Home" };
  return { title: `${detail.group.name} — Take Me Home` };
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getGroup(id);

  // Covers both "no such group" and "someone else's group" — RLS returns
  // nothing for either, and they should be indistinguishable from outside.
  if (!detail) notFound();

  const {
    group,
    role,
    members,
    tasks,
    assignments,
    activities,
    participation,
    readiness,
    self,
    ownTrips,
    linkedTripId,
  } = detail;

  const facts: Array<{ term: string; value: string }> = [
    { term: "Departure", value: formatDate(group.depart_on) ?? "Not set" },
    { term: "Return", value: formatDate(group.return_on) ?? "Not set" },
    { term: "Members", value: String(members.length) },
    { term: "Your role", value: role ?? "—" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <Link
        href="/groups"
        className="inline-block py-2 text-sm text-muted transition-colors hover:text-ivory"
      >
        ← All groups
      </Link>

      <p className="mt-6 text-label">Group</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        {group.name}
      </h1>

      {/* The route line as a connector, with no stops of its own. */}
      <div aria-hidden="true" className="mt-6 h-4 w-full max-w-xs text-sunset">
        <RouteMotif animated={false} stops={[]} />
      </div>

      <section className="mt-10" aria-labelledby="group-details">
        <h2 id="group-details" className="font-display text-xl text-ivory">
          Details
        </h2>
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.term}>
              <dt className="text-label">{fact.term}</dt>
              <dd className="mt-1.5 text-base text-ivory">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14" aria-labelledby="group-readiness">
        <h2 id="group-readiness" className="font-display text-xl text-ivory">
          How the group is going
        </h2>
        <div className="mt-5">
          <GroupReadinessPanel readiness={readiness} />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="group-tasks">
        <h2 id="group-tasks" className="font-display text-xl text-ivory">
          Tasks
        </h2>
        <div className="mt-5">
          <TaskBoard
            groupId={group.id}
            tasks={tasks}
            assignments={assignments}
            members={members}
            role={role}
          />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="group-activities">
        <h2 id="group-activities" className="font-display text-xl text-ivory">
          Activities
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Costs here are estimates and a note of who is booking. Take Me Home
          does not hold or move anyone&rsquo;s money.
        </p>
        <div className="mt-5">
          <ActivityBoard
            groupId={group.id}
            activities={activities}
            participation={participation}
            selfUserId={self?.user_id ?? null}
            role={role}
          />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="group-members">
        <h2 id="group-members" className="font-display text-xl text-ivory">
          Members
        </h2>
        <div className="mt-5">
          <MemberList
            groupId={group.id}
            members={members}
            role={role}
            selfUserId={self?.user_id ?? null}
          />
        </div>

        {can(role, "invite_member") ? (
          <div className="mt-8">
            <InviteForm groupId={group.id} />
          </div>
        ) : null}
      </section>

      {self ? (
        <section className="mt-14" aria-labelledby="own-membership">
          <h2 id="own-membership" className="font-display text-xl text-ivory">
            Your part in this
          </h2>
          <div className="mt-5 flex flex-col gap-6">
            {/*
              Linking comes first: the readiness a member can share is derived
              from their own trip, so the switch below has nothing to publish
              until a trip is linked.
            */}
            <LinkTripForm
              groupId={group.id}
              trips={ownTrips}
              linkedTripId={linkedTripId}
            />
            <OwnMembershipForm groupId={group.id} membership={self} />
          </div>
        </section>
      ) : null}

      <p className="mt-14 border-t border-ivory/10 pt-6 text-sm leading-relaxed text-muted">
        Your trip, travellers, documents and budget stay private to you. Nobody
        in this group — including whoever created it — can open them. What the
        group sees is the shared plan, and the readiness state you choose to
        share.
      </p>
    </div>
  );
}

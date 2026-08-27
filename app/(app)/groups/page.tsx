import Link from "next/link";
import type { Metadata } from "next";
import { listGroups } from "@/lib/groups/service";

export const metadata: Metadata = { title: "Groups — Take Me Home" };

/** Depends on the caller's session, so it is rendered per request. */
export const dynamic = "force-dynamic";

function formatWindow(departOn: string | null, returnOn: string | null): string {
  if (!departOn) return "No dates yet";
  const format = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return returnOn ? `${format(departOn)} – ${format(returnOn)}` : format(departOn);
}

export default async function GroupsPage() {
  // RLS scopes this to groups the caller belongs to. No membership predicate
  // is written here, because the policy is the filter.
  const groups = await listGroups();

  return (
    <div className="mx-auto max-w-content px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">Groups</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Travelling together
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/70">
        A group coordinates one journey. Your own trip, documents and budget
        stay private — the group sees the shared plan and whatever you choose to
        share.
      </p>

      {groups.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-ivory/15 bg-indigo-900/40 px-6 py-8">
          <h2 className="font-display text-xl text-ivory">No groups yet</h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
            Start one for the people travelling with you — family, friends, or
            anyone coordinating the same journey.
          </p>
          <Link
            href="/groups/new"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-sunset px-6 py-3 text-sm font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
          >
            Start a group
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-12 flex items-center justify-between gap-4">
            <h2 className="font-display text-xl text-ivory">
              {groups.length === 1 ? "1 group" : `${groups.length} groups`}
            </h2>
            <Link
              href="/groups/new"
              className="inline-flex items-center justify-center rounded-full bg-sunset px-5 py-2.5 text-sm font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
            >
              Start a group
            </Link>
          </div>

          <ul className="mt-6 flex flex-col gap-3" aria-label="Your groups">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 transition-colors hover:border-ivory/35"
                >
                  <span className="text-base text-ivory">
                    {group.name}
                    {group.role ? (
                      <span className="ml-3 text-label">{group.role}</span>
                    ) : null}
                  </span>
                  <span className="text-data text-sm text-muted">
                    {formatWindow(group.depart_on, group.return_on)}
                    {" · "}
                    {group.member_count === 1
                      ? "1 member"
                      : `${group.member_count} members`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

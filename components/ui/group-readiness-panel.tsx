import type { GroupReadiness, MemberCoordinationState } from "@/lib/groups/readiness";

/**
 * How the group is going.
 *
 * Two rules govern everything rendered here.
 *
 * The figure is over sharing members only, and the panel says so in words
 * beside it. A bare "6 of 8" invites the reader to treat 8 as the group size
 * and infer something about the other two.
 *
 * A member's state is a single word. This panel never renders why — the reason
 * lives behind that member's own policy, and an aggregate is not entitled to
 * restate it.
 */

const STATE_META: Record<
  MemberCoordinationState,
  { glyph: string; label: string; className: string }
> = {
  // State is carried by the glyph and the words. Colour is a third, redundant
  // signal — every row still reads correctly in greyscale.
  ready: {
    glyph: "●",
    label: "Ready",
    className: "border-baobab/40 bg-baobab/10 text-baobab-light",
  },
  complete: {
    glyph: "●",
    label: "Complete",
    className: "border-baobab/40 bg-baobab/10 text-baobab-light",
  },
  optional: {
    glyph: "○",
    label: "Optional",
    className: "border-ivory/25 bg-indigo-800/40 text-muted",
  },
  action_required: {
    glyph: "▲",
    label: "Action required",
    className: "border-sunset/40 bg-sunset/10 text-sunset",
  },
  blocked: {
    glyph: "■",
    label: "Blocked",
    className: "border-sunset/40 bg-sunset/10 text-sunset",
  },
};

function StateBadge({ state }: { state: MemberCoordinationState }) {
  const meta = STATE_META[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] ${meta.className}`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  );
}

export function GroupReadinessPanel({
  readiness,
}: {
  readiness: GroupReadiness;
}) {
  const {
    sharing,
    notSharingCount,
    unknownCount,
    readyCount,
    denominator,
    percent,
    noSharedStatus,
    actionableTasks,
    blockedTasks,
    overdueTasks,
  } = readiness;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="group-people">
        <h3 id="group-people" className="text-label">
          People
        </h3>

        {noSharedStatus ? (
          <p className="mt-4 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm leading-relaxed text-muted">
            Nobody has chosen to share their readiness with this group yet.
            Sharing is off until each traveller turns it on for themselves.
          </p>
        ) : (
          <>
            <p className="mt-4 text-data text-2xl text-ivory">
              {readyCount} / {denominator}
            </p>
            {/*
              The denominator is stated in words, not left to be inferred. "6 of
              8" beside a group of ten invites the reader to work out something
              about the other two.
            */}
            <p className="mt-1 text-sm leading-relaxed text-muted">
              travellers ready, of the {denominator} sharing their readiness
              {percent !== null ? ` · ${percent}%` : ""}
            </p>

            <ul className="mt-5 flex flex-col gap-2" aria-label="Shared readiness">
              {sharing.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-indigo-900/40 px-4 py-3"
                >
                  <span className="text-sm text-ivory">
                    {member.displayName ?? "A traveller"}
                  </span>
                  <StateBadge state={member.state} />
                </li>
              ))}
            </ul>
          </>
        )}

        {(notSharingCount > 0 || unknownCount > 0) && (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {notSharingCount > 0 && (
              <>
                {notSharingCount}{" "}
                {notSharingCount === 1 ? "traveller has" : "travellers have"} not
                shared their readiness. Nothing above counts them.
              </>
            )}
            {notSharingCount > 0 && unknownCount > 0 && " "}
            {unknownCount > 0 && (
              <>
                {unknownCount} shared but {unknownCount === 1 ? "has" : "have"}{" "}
                nothing to report yet.
              </>
            )}
          </p>
        )}
      </section>

      <section aria-labelledby="group-work">
        <h3 id="group-work" className="text-label">
          The plan
        </h3>

        {actionableTasks.length === 0 && blockedTasks.length === 0 ? (
          <p className="mt-4 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
            Nothing outstanding.
          </p>
        ) : (
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-label">Ready to do</dt>
              <dd className="mt-1.5 text-data text-xl text-ivory">
                {actionableTasks.length}
              </dd>
            </div>
            <div>
              <dt className="text-label">Waiting on something</dt>
              <dd className="mt-1.5 text-data text-xl text-ivory">
                {blockedTasks.length}
              </dd>
            </div>
            <div>
              <dt className="text-label">Overdue</dt>
              <dd className="mt-1.5 text-data text-xl text-ivory">
                {overdueTasks.length}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}

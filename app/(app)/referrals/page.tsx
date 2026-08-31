import type { Metadata } from "next";
import { ensureReferralCode, revokeInvitation } from "@/lib/referrals/actions";
import { REFERRAL_STATUS_LABELS } from "@/lib/referrals/lifecycle";
import { getReferralOverview } from "@/lib/referrals/service";
import { ReferralInviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Referrals — Take Me Home" };

/** Depends on the caller's session, so it is rendered per request. */
export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ReferralsPage() {
  // Idempotent: one code per person per programme, enforced by a unique
  // constraint rather than by this call happening exactly once.
  await ensureReferralCode();

  const { program, code, summary, entitlements, ownAttribution } =
    await getReferralOverview();

  return (
    <div className="mx-auto max-w-content px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">Referrals</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Introducing someone
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/70">
        Share your link with someone planning a journey home. You will see
        whether they joined and whether it counted — nothing about their trip,
        their documents or their budget.
      </p>

      {program === null ? (
        <div className="mt-10 rounded-2xl border border-ivory/15 bg-indigo-900/40 px-6 py-8">
          <h2 className="font-display text-xl text-ivory">
            No referral programme is running
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
            There is nothing to share at the moment.
          </p>
        </div>
      ) : (
        <>
          <section
            aria-labelledby="your-link"
            className="mt-10 rounded-2xl border border-ivory/15 bg-indigo-900/40 px-6 py-6"
          >
            <h2 id="your-link" className="font-display text-xl text-ivory">
              Your link
            </h2>
            {code ? (
              <>
                <p className="mt-4 break-all text-data text-lg text-sunset">
                  /r/{code.code}
                </p>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
                  Anyone who signs up within{" "}
                  {program.attribution_window_days} days of opening it is
                  attributed to you.
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">
                Your link could not be created. Reload the page to try again.
              </p>
            )}
          </section>

          <div className="mt-6">
            <ReferralInviteForm />
          </div>

          <section aria-labelledby="your-referrals" className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="your-referrals" className="font-display text-xl text-ivory">
                Your referrals
              </h2>
              <p className="text-data text-sm text-muted">
                {summary.counts.qualified} qualified · {summary.counts.joined}{" "}
                joined · {summary.counts.invited} invited
              </p>
            </div>

            {summary.referrals.length === 0 ? (
              <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted">
                Nothing yet. Invitations and link signups appear here.
              </p>
            ) : (
              <ul
                className="mt-5 flex flex-col gap-3"
                aria-label="Referrals you have made"
              >
                {summary.referrals.map((referral) => {
                  const status = REFERRAL_STATUS_LABELS[referral.status];
                  return (
                    <li
                      key={referral.key}
                      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
                    >
                      <span className="text-base text-ivory">
                        {/*
                          Only an address this person typed themselves. A code
                          shared in a group chat attributes perfectly well and
                          names nobody — the referrer did not invite that
                          address, so the engine will not tell them whose it is.
                        */}
                        {referral.invitedAddress ?? "Someone used your link"}
                      </span>
                      <span className="flex items-baseline gap-4 text-data text-sm text-muted">
                        {/*
                          Glyph and word together. State is never carried by
                          colour alone.
                        */}
                        <span>
                          <span aria-hidden="true">{status.glyph}</span>{" "}
                          {status.label} · {formatDate(referral.at)}
                        </span>
                        {referral.status === "invited" ? (
                          <form action={revokeInvitation}>
                            <input
                              type="hidden"
                              name="invitationId"
                              value={referral.key}
                            />
                            {/*
                              A POST, not a link. Withdrawing an invitation
                              changes server state, and a GET that mutates is
                              one prefetch away from doing it unasked.
                            */}
                            <button
                              type="submit"
                              className="py-1 text-sm text-ivory/70 underline transition-colors hover:text-ivory"
                            >
                              Withdraw
                              <span className="sr-only">
                                {" "}
                                the invitation to {referral.invitedAddress}
                              </span>
                            </button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {summary.lapsedCount > 0 ? (
              <p className="mt-4 text-sm text-muted">
                {summary.lapsedCount} invitation
                {summary.lapsedCount === 1 ? "" : "s"} withdrawn or expired.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="entitlements" className="mt-12">
            <h2 id="entitlements" className="font-display text-xl text-ivory">
              What you have earned
            </h2>
            {entitlements.length === 0 ? (
              <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted">
                Nothing yet. A referral earns something once it qualifies.
              </p>
            ) : (
              <ul className="mt-5 flex flex-col gap-3" aria-label="Your entitlements">
                {entitlements.map((entitlement) => (
                  <li
                    key={entitlement.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
                  >
                    <span className="text-base text-ivory">
                      {entitlement.reward_policy_key}
                    </span>
                    <span className="text-data text-sm text-muted">
                      {entitlement.revoked_at
                        ? `Reversed ${formatDate(entitlement.revoked_at)}`
                        : `Earned ${formatDate(entitlement.earned_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/*
              Said plainly rather than implied. This engine records that
              something was earned under a named policy; it holds no money and
              owes none, and a page that showed a balance here would be making
              a claim the product does not support.
            */}
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              Take Me Home does not hold money. An entitlement records that a
              referral qualified under a named policy — what that policy is
              worth is set outside this page.
            </p>
          </section>

          {ownAttribution ? (
            <section aria-labelledby="your-own" className="mt-12">
              <h2 id="your-own" className="font-display text-xl text-ivory">
                How you arrived
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
                {/*
                  The referred user can always see that they were attributed,
                  and to which link. Being the subject of an attribution you
                  cannot inspect is not a position to put someone in — and the
                  policy grants them this read for that reason.
                */}
                Your account was attributed to the referral link{" "}
                <span className="text-data text-ivory/80">
                  {ownAttribution.code}
                </span>{" "}
                on {formatDate(ownAttribution.attributed_at)}.
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

import { NextAction } from "@/components/ui/next-action";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { TripSummary } from "@/components/ui/trip-summary";
import { usd } from "@/lib/format";
import {
  DOCUMENTS_READY_COUNT,
  EXAMPLE_BUDGET_TOTALS,
  EXAMPLE_DOCUMENTS,
  EXAMPLE_NEXT_ACTION,
  EXAMPLE_SAVINGS,
  EXAMPLE_TRIP,
} from "@/lib/mock-data";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-ivory/10">
      {/* Warmth behind the fold — supporting context, not the explanation. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_75%_-10%,rgba(212,162,76,0.16),transparent_65%),radial-gradient(40rem_30rem_at_5%_20%,rgba(63,140,122,0.14),transparent_60%)]"
      />

      <div className="relative mx-auto grid max-w-content gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-start lg:gap-16 lg:py-24">
        <div>
          <p className="text-label">For the African diaspora</p>
          <h1 className="mt-4 font-display text-4xl leading-[1.1] tracking-tight text-ivory sm:text-5xl lg:text-6xl">
            Know exactly how ready you are to go home.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ivory/75">
            Take Me Home turns a trip home into something you can see: what your
            passport and documents need, what the trip will cost, what to save each
            month, and how many days are left.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#waitlist"
              className="inline-flex items-center justify-center rounded-full bg-sunset px-6 py-3 text-base font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
            >
              Join the waitlist
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-ivory/25 px-6 py-3 text-base text-ivory transition-colors hover:border-ivory/50"
            >
              See how it works
            </a>
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-2 gap-x-6 gap-y-6 border-t border-ivory/10 pt-8 sm:grid-cols-3">
            <div>
              <dt className="text-label">Estimated budget</dt>
              <dd className="text-data mt-1.5 text-xl text-ivory">
                {usd(EXAMPLE_BUDGET_TOTALS.target)}
              </dd>
            </div>
            <div>
              <dt className="text-label">Saved</dt>
              <dd className="text-data mt-1.5 text-xl text-ivory">
                {usd(EXAMPLE_SAVINGS.saved)}
              </dd>
            </div>
            <div>
              <dt className="text-label">Documents</dt>
              <dd className="text-data mt-1.5 text-xl text-ivory">
                {DOCUMENTS_READY_COUNT} of {EXAMPLE_DOCUMENTS.length} ready
              </dd>
            </div>
          </dl>
        </div>

        {/* Product demonstration. Illustrative figures — see the note below. */}
        <div className="space-y-4">
          <TripSummary trip={EXAMPLE_TRIP} />
          <NextAction {...EXAMPLE_NEXT_ACTION} />
          <div className="rounded-2xl border border-ivory/10 bg-indigo-900/50 p-5">
            <ReadinessMeter
              percent={Math.round(
                (EXAMPLE_SAVINGS.saved / EXAMPLE_BUDGET_TOTALS.target) * 100,
              )}
              label="Savings progress"
              size="sm"
            />
            <p className="mt-3 text-sm text-ivory/65">
              {usd(EXAMPLE_BUDGET_TOTALS.target - EXAMPLE_SAVINGS.saved)} to go over{" "}
              {EXAMPLE_SAVINGS.monthsRemaining} months.
            </p>
          </div>
          <p className="text-center font-mono text-[0.6875rem] leading-relaxed text-muted">
            Example trip. Figures are illustrative, not live data.
          </p>
        </div>
      </div>
    </section>
  );
}

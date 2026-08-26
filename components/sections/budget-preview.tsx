import { BudgetBreakdown } from "@/components/ui/budget-breakdown";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { usd, usdRange } from "@/lib/format";
import {
  EXAMPLE_ASSUMPTIONS,
  EXAMPLE_BUDGET,
  EXAMPLE_BUDGET_TOTALS,
  EXAMPLE_CONFIDENCE,
  EXAMPLE_SAVINGS,
} from "@/lib/mock-data";

export function BudgetPreview() {
  const remaining = EXAMPLE_BUDGET_TOTALS.target - EXAMPLE_SAVINGS.saved;
  const monthlyTarget = Math.round(remaining / EXAMPLE_SAVINGS.monthsRemaining);
  const savedPercent = Math.round(
    (EXAMPLE_SAVINGS.saved / EXAMPLE_BUDGET_TOTALS.target) * 100,
  );

  return (
    <section id="budget" className="scroll-mt-20 border-b border-ivory/10">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-20">
        <p className="text-label">Budget</p>
        <h2 className="mt-4 max-w-2xl font-display text-3xl leading-tight text-ivory sm:text-4xl">
          A number you can plan against, and the reasoning behind it.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ivory/70">
          Costs are calculated, not guessed. A deterministic estimation engine
          produces every figure below from your dates, travellers and destination.
          The assistant&rsquo;s job is to explain the number — never to invent it.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_minmax(0,24rem)] lg:gap-10">
          <div className="rounded-2xl border border-ivory/10 bg-indigo-900/50 p-5 sm:p-6">
            <BudgetBreakdown
              categories={EXAMPLE_BUDGET}
              target={EXAMPLE_BUDGET_TOTALS.target}
            />
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-sunset/30 bg-sunset/[0.07] p-5">
              <p className="text-label text-sunset/90">Estimated trip cost</p>
              <p className="text-data mt-2 text-2xl font-semibold text-ivory sm:text-3xl">
                {usdRange(EXAMPLE_BUDGET_TOTALS.low, EXAMPLE_BUDGET_TOTALS.high)}
              </p>
              <p className="mt-3 text-sm text-ivory/70">
                Planning target{" "}
                <span className="text-data text-ivory">
                  {usd(EXAMPLE_BUDGET_TOTALS.target)}
                </span>
              </p>
            </div>

            <div className="rounded-2xl border border-ivory/10 bg-indigo-900/50 p-5">
              <ReadinessMeter percent={savedPercent} label="Saved so far" size="sm" />
              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ivory/70">Already saved</dt>
                  <dd className="text-data text-ivory">{usd(EXAMPLE_SAVINGS.saved)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ivory/70">Remaining</dt>
                  <dd className="text-data text-ivory">{usd(remaining)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ivory/70">Months remaining</dt>
                  <dd className="text-data text-ivory">
                    {EXAMPLE_SAVINGS.monthsRemaining}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-ivory/10 pt-3">
                  <dt className="font-medium text-ivory">Monthly target</dt>
                  <dd className="text-data font-semibold text-baobab">
                    {usd(monthlyTarget)}
                  </dd>
                </div>
              </dl>
            </div>

            <details className="group rounded-2xl border border-ivory/10 bg-indigo-900/50 p-5">
              <summary className="cursor-pointer list-none py-1.5 text-sm font-medium text-ivory marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  Why this estimate?
                  <span
                    aria-hidden="true"
                    className="text-muted transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-label">Assumptions</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ivory/70">
                    {EXAMPLE_ASSUMPTIONS.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-label">Confidence</p>
                  <p className="mt-2 text-sm leading-relaxed text-ivory/70">
                    <span className="text-data text-ivory">
                      {EXAMPLE_CONFIDENCE.level}
                    </span>{" "}
                    — {EXAMPLE_CONFIDENCE.reason}
                  </p>
                </div>
              </div>
            </details>

            <p className="text-center font-mono text-[0.6875rem] leading-relaxed text-muted">
              Example estimate. Illustrative, not live data.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

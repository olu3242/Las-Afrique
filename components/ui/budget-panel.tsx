import type { TripBudget } from "@/lib/budget/service";
import type { CostCategory } from "@/lib/supabase/types";

/**
 * The budget as the traveller sees it.
 *
 * Receives figures and renders them. It derives bar widths and nothing else —
 * every number here was computed by the Cost Estimation Engine, and this
 * component must not be built in a way that assumes otherwise.
 */

const LABELS: Record<CostCategory, string> = {
  flights: "Flights",
  accommodation: "Accommodation",
  food: "Food",
  local_transport: "Local transport",
  visa_and_documents: "Visa and documents",
  travel_insurance: "Travel insurance",
  activities: "Activities",
  family_and_shopping: "Family and shopping",
  contingency: "Contingency",
};

function usd(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}${
    symbol ? "" : ` ${currency}`
  }`;
}

const CONFIDENCE: Record<string, { glyph: string; label: string }> = {
  low: { glyph: "○", label: "Low confidence" },
  medium: { glyph: "◐", label: "Medium confidence" },
  high: { glyph: "●", label: "High confidence" },
};

export function BudgetPanel({ budget }: { budget: TripBudget }) {
  const { estimate, savings } = budget;

  if (estimate.unavailableReason) {
    return (
      <p className="rounded-2xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm leading-relaxed text-muted">
        {estimate.unavailableReason}
      </p>
    );
  }

  const widest = Math.max(...estimate.categories.map((c) => c.high), 1);
  const confidence = CONFIDENCE[estimate.confidence];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5 sm:p-6">
        {estimate.restsOnIllustrativeRates ? (
          // Required by the project's rules and by plain honesty: a figure
          // built on placeholders must say so where the figure is, not in a
          // footnote further down.
          <p className="mb-4 flex gap-2 rounded-xl border border-sunset/40 bg-sunset/10 px-4 py-3 text-sm leading-relaxed text-ivory">
            <span aria-hidden="true" className="text-sunset">
              !
            </span>
            <span>
              Illustrative figures. These rest on planning placeholders rather
              than researched prices — use the range as a starting point, not a
              quote.
            </span>
          </p>
        ) : null}

        <p className="text-label">Planning target</p>
        <p className="mt-2 text-data text-3xl text-ivory">
          {usd(estimate.planningTarget, estimate.currency)}
        </p>
        <p className="mt-2 text-sm text-muted">
          Range {usd(estimate.estimateLow, estimate.currency)}–
          {usd(estimate.estimateHigh, estimate.currency)}
        </p>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true">{confidence.glyph}</span>
          {confidence.label}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {estimate.categories.map((line) => (
          <li key={line.category}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-ivory">{LABELS[line.category]}</p>
              <p className="text-data text-sm text-muted">
                {usd(line.low, estimate.currency)}–
                {usd(line.high, estimate.currency)}
              </p>
            </div>
            <div
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-indigo-800"
            >
              <div
                className="h-full rounded-full bg-sunset/70"
                style={{ width: `${Math.round((line.high / widest) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/*
        "Why this estimate?" — the PRD asks for the assumptions to be surfaced,
        and a <details> keeps them one click away rather than buried in a
        tooltip a keyboard user cannot reach.
      */}
      <details className="rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5 sm:p-6">
        <summary className="cursor-pointer py-1 text-sm text-ivory">
          Why this estimate?
        </summary>

        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted">
          {estimate.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>

        <table className="mt-5 w-full text-left text-sm">
          <caption className="sr-only">
            How each category was calculated
          </caption>
          <thead>
            <tr className="text-label">
              <th scope="col" className="pb-2">Category</th>
              <th scope="col" className="pb-2">Worked out as</th>
              <th scope="col" className="pb-2">Rate</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {estimate.categories.map((line) => (
              <tr key={line.category} className="border-t border-ivory/10">
                <td className="py-2 pr-4 text-ivory/90">
                  {LABELS[line.category]}
                </td>
                <td className="py-2 pr-4">{line.basisOfCalculation}</td>
                <td className="py-2">
                  {line.rateBasis === "verified" && line.sourceUrl ? (
                    <a
                      href={line.sourceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="inline-block py-1 text-ivory underline decoration-sunset underline-offset-4"
                    >
                      {line.sourceName}
                    </a>
                  ) : (
                    <span>Illustrative</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-5 text-data text-xs text-muted">
          {estimate.engineVersion}
        </p>
      </details>

      {savings ? (
        <div className="rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5 sm:p-6">
          <p className="text-label">Savings</p>
          <p className="mt-2 text-sm text-ivory">
            {usd(savings.amountSaved, estimate.currency)} saved of{" "}
            {usd(savings.targetAmount, estimate.currency)}
          </p>
          <p className="mt-2 text-sm text-muted">
            {savings.monthlyTarget !== null && savings.monthsRemaining !== null
              ? `${usd(savings.monthlyTarget, estimate.currency)} a month for ${
                  savings.monthsRemaining
                } ${savings.monthsRemaining === 1 ? "month" : "months"} covers the rest.`
              : "Add a departure date and we can work out a monthly target."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

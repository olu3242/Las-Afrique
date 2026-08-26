import { usd, usdRange } from "@/lib/format";
import type { BudgetCategory } from "@/lib/mock-data";

interface BudgetBreakdownProps {
  categories: BudgetCategory[];
  /** The planning figure every bar is measured against. */
  target: number;
}

/**
 * Category-level cost breakdown.
 *
 * Figures arrive already computed. The component renders what it is given and
 * derives nothing beyond bar widths — the arithmetic belongs to the Cost
 * Estimation Engine, which is the single source of truth for money.
 */
export function BudgetBreakdown({ categories, target }: BudgetBreakdownProps) {
  const largest = Math.max(...categories.map((category) => category.target));

  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">
        Estimated cost by category, with the low-to-high range for each
      </caption>
      <thead>
        <tr className="border-b border-ivory/10">
          <th scope="col" className="text-label pb-3 font-medium">
            Category
          </th>
          <th scope="col" className="text-label pb-3 text-right font-medium">
            Planning target
          </th>
          <th scope="col" className="text-label hidden pb-3 text-right font-medium sm:table-cell">
            Range
          </th>
        </tr>
      </thead>
      <tbody>
        {categories.map((category) => (
          <tr key={category.id} className="border-b border-ivory/[0.07] last:border-b-0">
            <th scope="row" className="py-3 pr-3 text-sm font-normal text-ivory/85">
              {category.label}
              <span
                aria-hidden="true"
                className="mt-1.5 block h-1 rounded-full bg-baobab/60"
                style={{ width: `${(category.target / largest) * 100}%` }}
              />
            </th>
            <td className="text-data py-3 text-right align-top text-sm text-ivory">
              {usd(category.target)}
            </td>
            <td className="text-data hidden py-3 pl-3 text-right align-top text-xs text-muted sm:table-cell">
              {usdRange(category.low, category.high)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-ivory/20">
          <th scope="row" className="pt-4 text-sm font-medium text-ivory">
            Planning target
          </th>
          <td className="text-data pt-4 text-right text-base font-semibold text-sunset">
            {usd(target)}
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      </tfoot>
    </table>
  );
}

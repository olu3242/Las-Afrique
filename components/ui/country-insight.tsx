import { DataFreshness } from "./data-freshness";
import type { CountryInsightData } from "@/lib/mock-data";

interface CountryInsightProps {
  country: CountryInsightData;
  /** Nigeria is the primary product example and gets the expanded treatment. */
  featured?: boolean;
}

/**
 * A country guide as a card.
 *
 * Deliberately states that a guide exists rather than stating its contents. Entry
 * and health requirements come from the Country Data Service in Phase 1, carrying
 * their own source and checked date. Nothing here should ever be read as advice.
 */
export function CountryInsight({ country, featured = false }: CountryInsightProps) {
  return (
    <article
      className={`flex h-full flex-col rounded-2xl border p-5 ${
        featured
          ? "border-sunset/30 bg-indigo-900"
          : "border-ivory/10 bg-indigo-900/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg text-ivory">{country.name}</h3>
        <span className="text-data rounded border border-ivory/15 px-1.5 py-0.5 text-[0.6875rem] text-muted">
          {country.currency}
        </span>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-label">Major cities</dt>
          <dd className="mt-1 text-ivory/75">{country.cities.join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-label">Country guide</dt>
          <dd className="mt-1 text-ivory/75">
            Entry, document and travel requirements available
          </dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        <DataFreshness checked={country.lastChecked} />
      </div>
    </article>
  );
}

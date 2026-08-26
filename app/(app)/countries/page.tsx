import Link from "next/link";
import type { Metadata } from "next";
import { listCountryGuides } from "@/lib/country/service";
import { CountryGuideCard } from "@/components/ui/country-guide-card";

export const metadata: Metadata = { title: "Country guides — Take Me Home" };
export const dynamic = "force-dynamic";

export default async function CountriesPage() {
  const guides = await listCountryGuides();

  return (
    <div className="mx-auto max-w-content px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">Country guides</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Where Take Me Home can help
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-ivory/70">
        Each guide shows when it was last checked and what it is based on. Take
        Me Home surfaces requirements — it is not the authority on them, so
        verify against the official source before you travel.
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {guides.map((guide) => (
          <li key={guide.key}>
            <Link
              href={`/countries/${guide.key}`}
              className="block rounded-2xl transition-opacity hover:opacity-90"
            >
              <CountryGuideCard guide={guide} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

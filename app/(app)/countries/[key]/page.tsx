import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCountryGuide } from "@/lib/country/service";
import { CountryGuideCard } from "@/components/ui/country-guide-card";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const guide = await getCountryGuide(key);
  return {
    title: guide
      ? `${guide.name} guide — Take Me Home`
      : "Country guide not found — Take Me Home",
  };
}

export default async function CountryGuidePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  // Resolves aliases, so /countries/cote-d-ivoire and /countries/ivory-coast
  // reach the same guide. An unknown destination is a 404 rather than the
  // nearest match — showing the wrong country's entry requirements is worse
  // than showing none.
  const guide = await getCountryGuide(key);
  if (!guide) notFound();

  const sections = guide.requirements
    ? ([
        ["Visa and entry", guide.requirements.visaEntry],
        ["Passport", guide.requirements.passportConsiderations],
        ["Emergency", guide.requirements.emergency],
        ["Customs", guide.requirements.customs],
        ["Advisories", guide.requirements.advisories],
      ] as const).filter(([, value]) => value !== null)
    : [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <Link
        href="/countries"
        className="inline-block py-2 text-sm text-muted transition-colors hover:text-ivory"
      >
        ← All country guides
      </Link>

      <p className="mt-6 text-label">Country guide</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        {guide.name}
      </h1>

      <div className="mt-8">
        <CountryGuideCard guide={guide} />
      </div>

      {sections.length > 0 ? (
        <div className="mt-10 flex flex-col gap-6">
          {sections.map(([heading, value]) => (
            <section key={heading}>
              <h2 className="font-display text-lg text-ivory">{heading}</h2>
              {/*
                Rendered as the source supplied it. This page does not
                summarise, paraphrase or fill gaps — every one of those is a
                way to end up stating something the source did not say.
              */}
              <pre className="mt-3 overflow-x-auto rounded-xl border border-ivory/15 bg-indigo-900/40 p-4 text-sm text-ivory/80">
                {JSON.stringify(value, null, 2)}
              </pre>
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-10 text-sm leading-relaxed text-muted">
          When a verified source is attached to this guide, its entry
          requirements appear here with the date they were checked.
        </p>
      )}
    </div>
  );
}

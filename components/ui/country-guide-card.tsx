import type { CountryGuide } from "@/lib/country/service";

/**
 * A country guide as the traveller sees it.
 *
 * Receives a guide and renders it. It does not decide what is verified, does
 * not derive freshness, and never fills a gap with a plausible sentence — if
 * the service says a guide carries nothing verified, this says exactly that.
 *
 * Every state pairs a glyph with a text label, so none of it depends on
 * colour. The tints are chosen against the composited surface, not the page
 * ground.
 */

const TONE: Record<
  CountryGuide["freshness"]["state"],
  { border: string; bg: string; glyph: string }
> = {
  // baobab-light rather than baobab: small text on a baobab-tinted surface
  // falls below the AA floor.
  fresh: { border: "border-baobab/40", bg: "bg-baobab/10", glyph: "text-baobab-light" },
  aging: { border: "border-sunset/40", bg: "bg-sunset/10", glyph: "text-sunset" },
  stale: { border: "border-sunset/60", bg: "bg-sunset/15", glyph: "text-sunset" },
  unverified: { border: "border-ivory/20", bg: "bg-indigo-800/40", glyph: "text-muted" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CountryGuideCard({ guide }: { guide: CountryGuide }) {
  const tone = TONE[guide.freshness.state];

  return (
    <section
      aria-labelledby={`guide-${guide.key}`}
      className={`rounded-2xl border ${tone.border} ${tone.bg} p-5 sm:p-6`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id={`guide-${guide.key}`} className="font-display text-xl text-ivory">
          {guide.name}
        </h2>
        <p className="text-data text-sm text-muted">{guide.currency}</p>
      </div>

      <p className="mt-3 flex items-start gap-2 text-sm text-ivory">
        <span aria-hidden="true" className={tone.glyph}>
          {guide.freshness.glyph}
        </span>
        <span>
          <span className="font-medium">{guide.freshness.label}</span>
          {" — "}
          <span className="text-ivory/70">{guide.freshness.detail}</span>
        </span>
      </p>

      {guide.majorCities.length > 0 ? (
        <p className="mt-4 text-sm text-muted">
          <span className="text-label">Cities</span>{" "}
          <span className="text-ivory/80">{guide.majorCities.join(" · ")}</span>
        </p>
      ) : null}

      {guide.provenance ? (
        <p className="mt-4 text-sm text-muted">
          <span className="text-label">Source</span>{" "}
          <a
            href={guide.provenance.sourceUrl}
            rel="noopener noreferrer"
            target="_blank"
            className="inline-block py-1 text-ivory underline decoration-sunset underline-offset-4"
          >
            {guide.provenance.sourceName}
          </a>
          <span className="text-muted">
            {" "}
            · checked {formatDate(guide.provenance.lastVerifiedAt)}
          </span>
        </p>
      ) : (
        // Says what is missing rather than rendering an empty section, which
        // would read as "nothing is required".
        <p className="mt-4 text-sm leading-relaxed text-muted">
          No verified source is attached to this guide yet, so Take Me Home has
          nothing to tell you about entry requirements for {guide.name}.
        </p>
      )}
    </section>
  );
}

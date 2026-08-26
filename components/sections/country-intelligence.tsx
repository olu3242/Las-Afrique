"use client";

import { useState } from "react";
import { CountryInsight } from "@/components/ui/country-insight";
import { LAUNCH_COUNTRIES } from "@/lib/mock-data";

export function CountryIntelligence() {
  // Nigeria is the primary product example and the default selection.
  const [selectedId, setSelectedId] = useState(LAUNCH_COUNTRIES[0].id);
  const selected =
    LAUNCH_COUNTRIES.find((country) => country.id === selectedId) ??
    LAUNCH_COUNTRIES[0];

  return (
    <section id="countries" className="scroll-mt-20 border-b border-ivory/10 bg-indigo-900/30">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-20">
        <p className="text-label">Country intelligence</p>
        <h2 className="mt-4 max-w-2xl font-display text-3xl leading-tight text-ivory sm:text-4xl">
          Eleven countries at launch, each with a guide that says when it was last
          checked.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ivory/70">
          Entry rules change. Take Me Home keeps a country guide for each launch
          destination and shows you how fresh it is, so you always know whether to
          double-check before booking.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_minmax(0,22rem)] lg:gap-12">
          <div>
            <h3 className="text-label" id="country-list-label">
              Launch countries
            </h3>
            <ul
              aria-labelledby="country-list-label"
              className="mt-4 flex flex-wrap gap-2"
            >
              {LAUNCH_COUNTRIES.map((country) => {
                const isSelected = country.id === selected.id;
                return (
                  <li key={country.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(country.id)}
                      className={`rounded-full border px-4 py-2.5 text-sm transition-colors ${
                        isSelected
                          ? "border-sunset bg-sunset text-indigo-950"
                          : "border-ivory/20 text-ivory/75 hover:border-ivory/45 hover:text-ivory"
                      }`}
                    >
                      {country.name}
                    </button>
                  </li>
                );
              })}
            </ul>

            <dl className="mt-10 grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-label">Currency</dt>
                <dd className="text-data mt-1.5 text-lg text-ivory">
                  {selected.currency}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-label">Major cities</dt>
                <dd className="mt-1.5 text-lg text-ivory">
                  {selected.cities.join(" · ")}
                </dd>
              </div>
            </dl>

            <p className="mt-8 max-w-xl text-xs leading-relaxed text-muted">
              Country guides cover entry requirements, passport considerations,
              customs, emergency contacts and advisories, each carrying its source
              and the date it was last verified. Take Me Home surfaces that
              information — it is not the authority on it. Confirm with the relevant
              embassy or government before you travel.
            </p>
          </div>

          {/* aria-live so keyboard and screen-reader users hear the card change. */}
          <div aria-live="polite">
            <CountryInsight country={selected} featured />
          </div>
        </div>
      </div>
    </section>
  );
}

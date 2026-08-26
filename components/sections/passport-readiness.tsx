import { DocumentRow } from "@/components/ui/document-row";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ReadinessState } from "@/lib/readiness";
import {
  DOCUMENTS_READY_COUNT,
  EXAMPLE_DOCUMENTS,
  EXAMPLE_TRIP,
} from "@/lib/mock-data";

const STATE_ORDER: ReadinessState[] = [
  "ready",
  "action-needed",
  "upcoming",
  "expiring",
  "missing",
];

export function PassportReadiness() {
  const percentReady = Math.round(
    (DOCUMENTS_READY_COUNT / EXAMPLE_DOCUMENTS.length) * 100,
  );

  return (
    <section id="documents" className="scroll-mt-20 border-b border-ivory/10 bg-indigo-900/30">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
          <div>
            <p className="text-label">Passport and documents</p>
            <h2 className="mt-4 font-display text-3xl leading-tight text-ivory sm:text-4xl">
              Every document, every traveller, every deadline.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-ivory/70">
              Take Me Home tracks what each traveller needs and when it needs to be
              done, so a passport renewal never becomes the reason the trip slips.
            </p>

            <div className="mt-8 rounded-2xl border border-ivory/10 bg-indigo-900/60 p-5">
              <ReadinessMeter
                percent={percentReady}
                label="Documents ready"
                size="sm"
              />
              <p className="text-data mt-3 text-sm text-ivory/80">
                {DOCUMENTS_READY_COUNT} of {EXAMPLE_DOCUMENTS.length} · {EXAMPLE_TRIP.travellers} travellers
              </p>
            </div>

            <div className="mt-6">
              <p className="text-label">States</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {STATE_ORDER.map((state) => (
                  <li key={state}>
                    <StatusBadge state={state} />
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Take Me Home tells you what to prepare and by when. It does not give
                immigration, legal or medical advice — always confirm requirements
                with the relevant authority before you travel.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-ivory/10 bg-indigo-900/60 p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4 border-b border-ivory/10 pb-4">
              <h3 className="font-display text-lg text-ivory">
                {EXAMPLE_TRIP.city} · {EXAMPLE_TRIP.window}
              </h3>
              <span className="text-label">Checklist</span>
            </div>
            <ul>
              {EXAMPLE_DOCUMENTS.map((document) => (
                <DocumentRow key={document.id} document={document} />
              ))}
            </ul>
            <p className="mt-5 font-mono text-[0.6875rem] leading-relaxed text-muted">
              Example checklist. Illustrative, not live data.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

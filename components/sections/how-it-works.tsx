import { RouteMotif } from "@/components/ui/route-motif";
import { TimelineStep } from "@/components/ui/timeline-step";
import { JOURNEY_STEPS } from "@/lib/mock-data";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-b border-ivory/10">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-20">
        <p className="text-label">How it works</p>
        <h2 className="mt-4 max-w-2xl font-display text-3xl leading-tight text-ivory sm:text-4xl">
          Four stages, from the first idea to the day you land.
        </h2>

        {/* The signature line carries the stages on wide screens. */}
        <div
          aria-hidden="true"
          className="relative mt-14 hidden h-16 text-ivory/40 sm:block"
        >
          <RouteMotif stops={[]} />
        </div>

        <ol className="mt-4 grid gap-0 sm:grid-cols-4 sm:gap-6">
          {JOURNEY_STEPS.map((step, index) => (
            <TimelineStep key={step.id} step={step} index={index} />
          ))}
        </ol>
      </div>
    </section>
  );
}

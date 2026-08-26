import type { PlannerOutcome } from "@/lib/planner/service";
import type { PlannerTools } from "@/lib/planner/contract";

/**
 * The planner's output, or an honest account of why there isn't any.
 *
 * Figures are resolved from the tool snapshot by reference — the plan's prose
 * is rendered, but the numbers beside it come from the engines, not from the
 * text. That is the same separation the verifier enforces, made visible.
 */
export function PlannerPanel({
  outcome,
  tools,
}: {
  outcome: PlannerOutcome;
  tools: PlannerTools;
}) {
  if (outcome.status === "unavailable") {
    return (
      <p className="rounded-2xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm leading-relaxed text-muted">
        {outcome.reason}
      </p>
    );
  }

  if (outcome.status === "rejected") {
    // Shown as a refusal, not as a plan with caveats. A model that broke the
    // contract is not more reliable in its next sentence.
    return (
      <div className="rounded-2xl border border-sunset/40 bg-sunset/10 p-5 sm:p-6">
        <p className="flex gap-2 text-sm text-ivory">
          <span aria-hidden="true" className="text-sunset">
            !
          </span>
          <span>
            The generated plan did not hold to what the engines actually say,
            so it was discarded rather than shown. Your budget, readiness and
            country guide above are unaffected.
          </span>
        </p>
        <ul className="mt-4 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
          {outcome.violations.map((violation) => (
            <li key={violation.detail}>{violation.detail}</li>
          ))}
        </ul>
      </div>
    );
  }

  const byRef = new Map(tools.figures.map((f) => [f.ref, f]));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base leading-relaxed text-ivory/80">
        {outcome.plan.summary}
      </p>

      <ol className="flex flex-col gap-4">
        {outcome.plan.steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-2xl border border-ivory/15 bg-indigo-900/40 p-5"
          >
            <p className="text-label">Step {index + 1}</p>
            <h3 className="mt-2 font-display text-lg text-ivory">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ivory/70">
              {step.body}
            </p>

            {step.figureRefs.length > 0 ? (
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
                {step.figureRefs.map((ref) => {
                  const figure = byRef.get(ref);
                  if (!figure) return null;
                  return (
                    <div key={ref}>
                      <dt className="text-label">{figure.label}</dt>
                      {/* From the engine, by reference — never from the prose. */}
                      <dd className="text-data text-ivory">
                        {figure.value.toLocaleString("en-US")} {figure.currency}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

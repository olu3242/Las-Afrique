interface ReadinessMeterProps {
  /** 0–100. */
  percent: number;
  label?: string;
  /** Renders the compact variant used inside dense cards. */
  size?: "sm" | "lg";
}

/**
 * Overall homecoming readiness. Exposed as a progressbar so assistive technology
 * reads the same figure a sighted user sees.
 */
export function ReadinessMeter({
  percent,
  label = "Homecoming readiness",
  size = "lg",
}: ReadinessMeterProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label">{label}</span>
        <span
          className={`text-data font-semibold text-sunset ${
            size === "lg" ? "text-2xl" : "text-base"
          }`}
        >
          {clamped}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={`mt-2 w-full overflow-hidden rounded-full bg-indigo-800 ${
          size === "lg" ? "h-2" : "h-1.5"
        }`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-baobab to-sunset transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

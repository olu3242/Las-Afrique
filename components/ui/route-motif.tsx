interface RouteMotifProps {
  className?: string;
  /**
   * Draws the line in on mount. The keyframe is neutralised under
   * prefers-reduced-motion by the global rule in globals.css, so the finished
   * line is simply present rather than animating.
   */
  animated?: boolean;
  /** Marker positions along the path, 0–1. Two points reads as origin → destination. */
  stops?: number[];
}

/**
 * The signature motif: the line from where you are to where home is.
 *
 * This is the product's one visual idea. It carries the hero, the journey
 * timeline and — in Phase 1 — the trip dashboard and departure countdown. Do not
 * introduce a second, competing motif alongside it.
 *
 * Decorative: the surrounding copy states the journey in words.
 */
export function RouteMotif({
  className = "",
  animated = true,
  stops = [0, 1],
}: RouteMotifProps) {
  // A gentle great-circle-ish arc. Kept in a fixed viewBox so it scales cleanly
  // from a 320px phone to a wide desktop without redrawing.
  const path = "M 24 96 C 200 24, 600 24, 776 60";
  // The furthest stop reads as home, and gets the larger sunset marker.
  const destination = stops.length ? Math.max(...stops) : null;

  return (
    <svg
      viewBox="0 0 800 120"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={`h-full w-full ${className}`}
    >
      <path
        d={path}
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
        strokeDasharray="4 6"
        strokeLinecap="round"
      />
      <path
        d={path}
        pathLength="1"
        stroke="url(#route-gradient)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1"
        strokeDashoffset={animated ? 1 : 0}
        className={animated ? "animate-route-draw" : undefined}
      />
      {stops.map((stop) => {
        // Sample the arc so markers sit on the line rather than near it.
        const point = pointOnArc(stop);
        const isDestination = stop === destination;
        return (
          <g key={stop}>
            <circle
              cx={point.x}
              cy={point.y}
              r={isDestination ? 9 : 6}
              fill={isDestination ? "#D4A24C" : "#3F8C7A"}
              fillOpacity="0.18"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={isDestination ? 4.5 : 3.5}
              fill={isDestination ? "#D4A24C" : "#3F8C7A"}
            />
          </g>
        );
      })}
      <defs>
        <linearGradient id="route-gradient" x1="0" y1="0" x2="800" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3F8C7A" />
          <stop offset="1" stopColor="#D4A24C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Cubic Bézier evaluation for the arc above, so markers land exactly on the path. */
function pointOnArc(t: number): { x: number; y: number } {
  const p0 = { x: 24, y: 96 };
  const p1 = { x: 200, y: 24 };
  const p2 = { x: 600, y: 24 };
  const p3 = { x: 776, y: 60 };

  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;

  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

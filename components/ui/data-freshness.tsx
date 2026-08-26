interface DataFreshnessProps {
  /** Human-readable recency, e.g. "6 days ago". */
  checked: string;
  source?: string;
}

/**
 * Country information ages. Showing when it was last checked is how travellers
 * judge whether to trust it — and a standing reminder to verify before travel.
 */
export function DataFreshness({ checked, source }: DataFreshnessProps) {
  return (
    <p className="font-mono text-[0.6875rem] leading-relaxed text-muted">
      Last checked {checked}
      {source ? ` · ${source}` : ""} · Verify before travel
    </p>
  );
}

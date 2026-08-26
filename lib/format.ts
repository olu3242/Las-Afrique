/** Whole-dollar formatting for estimate figures. Cents are noise at this altitude. */
export function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Compact range, e.g. "$7,800–$8,600". */
export function usdRange(low: number, high: number): string {
  return `${usd(low)}–${usd(high)}`;
}

interface NextActionProps {
  label: string;
  detail: string;
  due: string;
}

/**
 * One thing to do next. The product's answer to "what do I need to do?" — a
 * single prompt rather than a list the traveller has to triage.
 */
export function NextAction({ label, detail, due }: NextActionProps) {
  return (
    <div className="rounded-2xl border border-sunset/30 bg-sunset/[0.07] p-5">
      <p className="text-label text-sunset/90">Next action</p>
      <p className="mt-2 font-display text-lg text-ivory">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-ivory/70">{detail}</p>
      <p className="text-data mt-3 text-xs text-sunset">{due}</p>
    </div>
  );
}

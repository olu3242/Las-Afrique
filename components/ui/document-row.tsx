import { StatusBadge } from "./status-badge";
import type { DocumentItem } from "@/lib/mock-data";

interface DocumentRowProps {
  document: DocumentItem;
}

/** One row of the document checklist — the Phase 1 vault's list item, previewed. */
export function DocumentRow({ document }: DocumentRowProps) {
  return (
    <li className="flex flex-col gap-3 border-b border-ivory/10 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ivory">{document.name}</p>
        <p className="text-label mt-1 normal-case tracking-normal">
          {document.owner}
        </p>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ivory/60">
          {document.note}
        </p>
      </div>
      <StatusBadge state={document.state} />
    </li>
  );
}

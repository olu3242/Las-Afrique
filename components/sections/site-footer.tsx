import { RouteMotif } from "@/components/ui/route-motif";

export function SiteFooter() {
  return (
    <footer className="border-t border-ivory/10 bg-indigo-900/40">
      <div className="mx-auto max-w-content px-5 py-12 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-4 w-10 text-sunset">
              <RouteMotif animated={false} />
            </span>
            <span className="font-display text-lg text-ivory">Take Me Home</span>
          </div>
          <p className="text-sm text-muted">
            Homecoming planning for the African diaspora.
          </p>
        </div>

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
          Take Me Home helps you prepare for travel. It does not provide
          immigration, legal, financial or medical advice, and it does not book
          flights or accommodation. Trip figures shown on this page are
          illustrative examples. Always confirm entry requirements with the
          relevant authority before you travel.
        </p>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { RouteMotif } from "@/components/ui/route-motif";

/**
 * Shell for authenticated product routes.
 *
 * Separate from the marketing shell: this one assumes a signed-in user and will
 * carry trip context, navigation and the readiness summary as later iterations
 * fill it in. Access is gated in middleware, not here — a layout is not an
 * authorisation boundary.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ivory/10 bg-indigo-900/40">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 py-1.5">
            <span aria-hidden="true" className="hidden h-4 w-10 text-sunset sm:block">
              <RouteMotif animated={false} />
            </span>
            <span className="font-display text-lg tracking-tight text-ivory">
              Take Me Home
            </span>
          </Link>
          <nav aria-label="Account">
            <Link
              href="/"
              className="inline-block py-2 text-sm text-ivory/70 transition-colors hover:text-ivory"
            >
              Back to site
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}

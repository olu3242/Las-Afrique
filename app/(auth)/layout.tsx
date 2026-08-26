import Link from "next/link";
import { RouteMotif } from "@/components/ui/route-motif";

/**
 * Shell for the sign-in and sign-up routes.
 *
 * Public, like the marketing site, but without its navigation: a page whose
 * whole job is one form should not offer eight ways to leave it.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ivory/10">
        <div className="mx-auto flex max-w-content items-center px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 py-1.5">
            <span aria-hidden="true" className="hidden h-4 w-10 text-sunset sm:block">
              <RouteMotif animated={false} />
            </span>
            <span className="font-display text-lg tracking-tight text-ivory">
              Take Me Home
            </span>
          </Link>
        </div>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-5 py-12 sm:px-8 sm:py-20">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { RouteMotif } from "@/components/ui/route-motif";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#documents", label: "Documents" },
  { href: "#budget", label: "Budget" },
  { href: "#countries", label: "Countries" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ivory/10 bg-indigo-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <a href="#main" className="flex items-center gap-3 py-1.5">
          <span aria-hidden="true" className="hidden h-4 w-10 text-sunset sm:block">
            <RouteMotif animated={false} />
          </span>
          <span className="font-display text-lg tracking-tight text-ivory">
            Take Me Home
          </span>
        </a>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-block py-2 text-sm text-ivory/70 transition-colors hover:text-ivory"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-4">
          {/*
            A real route now, not an anchor. Accounts exist as of Iteration 2,
            so the marketing site has somewhere to hand a returning traveller.
          */}
          <Link
            href="/login"
            className="inline-block py-2 text-sm text-ivory/70 transition-colors hover:text-ivory"
          >
            Sign in
          </Link>
          <a
            href="#waitlist"
            className="rounded-full bg-sunset px-5 py-2.5 text-sm font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </header>
  );
}

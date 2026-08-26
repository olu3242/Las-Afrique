import { BudgetPreview } from "@/components/sections/budget-preview";
import { CountryIntelligence } from "@/components/sections/country-intelligence";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { PassportReadiness } from "@/components/sections/passport-readiness";
import { Problem } from "@/components/sections/problem";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/sections/site-header";
import { Waitlist } from "@/components/sections/waitlist";

export default function HomePage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-sunset focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-indigo-950"
      >
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <PassportReadiness />
        <BudgetPreview />
        <CountryIntelligence />
        <Waitlist />
      </main>

      <SiteFooter />
    </>
  );
}

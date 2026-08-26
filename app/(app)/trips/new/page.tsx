import type { Metadata } from "next";
import { listCountryOptions } from "@/lib/trips/service";
import { TripIntakeForm } from "./trip-intake-form";

export const metadata: Metadata = {
  title: "Plan a trip — Take Me Home",
};

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  // Read from the country table rather than a constant, so the form can only
  // offer destinations the foreign key will actually accept.
  const countries = await listCountryOptions();

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">New trip</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Where are you going home to?
      </h1>
      <p className="mt-5 text-base leading-relaxed text-ivory/70">
        Only the destination is required now. Dates, travellers and the rest can
        follow — you can change any of it later.
      </p>

      <TripIntakeForm countries={countries} />
    </div>
  );
}

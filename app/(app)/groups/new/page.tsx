import type { Metadata } from "next";
import { listCountryOptions } from "@/lib/trips/service";
import { GroupForm } from "./group-form";

export const metadata: Metadata = { title: "Start a group — Take Me Home" };

export const dynamic = "force-dynamic";

export default async function NewGroupPage() {
  // Read from the country table rather than a constant, so the form can only
  // offer destinations the foreign key will actually accept.
  const countries = await listCountryOptions();

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-label">New group</p>
      <h1 className="mt-4 font-display text-3xl text-ivory sm:text-4xl">
        Who is travelling with you?
      </h1>
      <p className="mt-5 text-base leading-relaxed text-ivory/70">
        Only a name is required. You can invite people, add the plan and set
        dates afterwards.
      </p>

      <GroupForm countries={countries} />
    </div>
  );
}

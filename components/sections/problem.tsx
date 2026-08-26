const FRICTIONS = [
  {
    title: "The date keeps moving",
    body: "A trip home gets planned in fragments — a fare check here, a passport reminder there — and slides another year.",
  },
  {
    title: "The paperwork surprises you",
    body: "Passport validity windows, entry requirements and health records each have their own lead time. Missing one late is expensive.",
  },
  {
    title: "The real cost is unclear",
    body: "Flights are the number everyone quotes. Family, shopping, local transport and the trip's long tail are the ones that hurt.",
  },
];

export function Problem() {
  return (
    <section className="border-b border-ivory/10 bg-indigo-900/30">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-20">
        <h2 className="max-w-2xl font-display text-3xl leading-tight text-ivory sm:text-4xl">
          Going home is rarely one decision. It&rsquo;s forty small ones, spread
          across a year.
        </h2>

        <ul className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {FRICTIONS.map((friction) => (
            <li key={friction.title}>
              <h3 className="font-display text-lg text-ivory">{friction.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ivory/65">
                {friction.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

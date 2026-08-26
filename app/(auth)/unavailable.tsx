/**
 * What the auth routes render when Supabase is not configured.
 *
 * A fresh checkout with no .env.local, and CI's end-to-end run, both hit this.
 * Without it the page throws: `requirePublicSupabaseEnv` is doing its job, but
 * a 500 is a bad way to say "not configured", and it turns the middleware's
 * fail-closed redirect into a crash.
 *
 * Failing closed means unavailable, not broken and not open.
 */
export function AuthUnavailable({ action }: { action: string }) {
  return (
    <>
      <h1 className="font-display text-3xl text-ivory">{action}</h1>
      <p
        role="status"
        className="mt-6 flex gap-3 rounded-xl border border-sunset/40 bg-sunset/10 px-4 py-3 text-sm leading-relaxed text-ivory"
      >
        <span aria-hidden="true" className="text-sunset">
          !
        </span>
        <span>
          Accounts are unavailable — this deployment has no database configured
          yet. Nothing you enter here would be saved.
        </span>
      </p>
    </>
  );
}

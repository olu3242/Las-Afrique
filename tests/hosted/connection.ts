/**
 * Shared configuration for the hosted suites.
 *
 * Nothing here has a default that would let a suite silently pass against the
 * wrong database, or against no database at all. A missing value is a hard
 * failure with a message naming what to set.
 */

export interface HostedConfig {
  databaseUrl: string;
  supabaseUrl: string;
  publishableKey: string;
}

/**
 * Postgres connection to the project.
 *
 * SUPABASE_DB_URL must be supplied verbatim from the dashboard. There is no
 * constructed fallback: the direct host is IPv6-only and unreachable from a
 * GitHub runner, and the pooler's hostname embeds a region that cannot be
 * derived from the project ref. Guessing it produced a connection error that
 * read like a network fault rather than a configuration one.
 */
export function databaseUrl(): string {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) return explicit;

  throw new Error(
    "SUPABASE_DB_URL is not set.\n\n" +
      "It is required rather than optional: a Supabase project's direct host " +
      "(db.<ref>.supabase.co) resolves to IPv6 only, and GitHub-hosted runners " +
      "have no IPv6 route — the first hosted run failed with " +
      "`connect ENETUNREACH 2600:1f10:…:5432`. The pooled connection string is " +
      "reachable over IPv4.\n\n" +
      "Copy it from the project's Connect dialog (Session pooler) and store it " +
      "as the SUPABASE_DB_URL secret.",
  );
}

/**
 * TLS settings for the hosted connection.
 *
 * Supabase requires TLS, so that is the default. A connection string that opts
 * out explicitly (`sslmode=disable`) is honoured, which is what makes it
 * possible to rehearse this suite against a local cluster before pointing it at
 * the real project.
 */
export function sslConfig(url: string): false | { rejectUnauthorized: boolean } {
  return /[?&]sslmode=disable(&|$)/.test(url)
    ? false
    : { rejectUnauthorized: false };
}

export function apiConfig(): { supabaseUrl: string; publishableKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "Hosted API tests need NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return { supabaseUrl, publishableKey };
}

/** Migration versions the repository declares, in the order they apply. */
export function repoMigrationVersions(): string[] {
  // Mirrors the CLI's own rule: /^([0-9]+)_(.*)\.sql$/ — leading digits are the
  // version, and versions sort lexically.
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  return readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((name) => /^[0-9]+_.*\.sql$/.test(name))
    .map((name) => name.match(/^([0-9]+)_/)![1])
    .sort();
}

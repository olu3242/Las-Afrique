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
 * Direct Postgres connection to the project.
 *
 * Prefer SUPABASE_DB_URL copied verbatim from the dashboard: Supabase projects
 * differ in whether they expose a direct or a pooled connection, and in which
 * region host serves the pooler, so a string assembled from a project ref is a
 * guess. The constructed form is a fallback for projects that still serve the
 * direct host.
 */
export function databaseUrl(): string {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) return explicit;

  const ref = process.env.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!ref || !password) {
    throw new Error(
      "No hosted database connection. Set SUPABASE_DB_URL (preferred — copy it " +
        "from the project's Connect dialog), or both SUPABASE_PROJECT_REF and " +
        "SUPABASE_DB_PASSWORD.",
    );
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
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

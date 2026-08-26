import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const SHIM = join(process.cwd(), "supabase", "test", "00_auth_shim.sql");

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:55432/postgres";

/** Migration files in lexical order — the order they must be applied in. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Build a throwaway database, apply the auth shim then every migration in
 * order, and hand back a connected client.
 *
 * Each suite gets its own database so migration order is exercised from scratch
 * rather than against leftover state.
 */
export async function createMigratedDatabase(
  name: string,
  /**
   * Optional SQL run after the auth shim and before the migrations. Used to
   * reproduce settings a hosted project carries but a bare cluster does not —
   * notably the default privileges that grant `anon` on new public tables.
   */
  beforeMigrations?: string,
): Promise<Client> {
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  const db = new Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(readFileSync(SHIM, "utf8"));
  if (beforeMigrations) await db.query(beforeMigrations);
  for (const file of migrationFiles()) {
    await db.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  return db;
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
    [name],
  );
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}

/** Insert a user into the shim's auth.users and return its id. */
export async function createUser(db: Client, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  );
  return rows[0].id;
}

/**
 * Run a callback as a signed-in user: role `authenticated`, with auth.uid()
 * resolving to `userId` — the same shape PostgREST sets up per request.
 *
 * Wrapped in a transaction with `local` settings so the role and claim cannot
 * leak into the next assertion.
 */
export async function asUser<T>(
  db: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await db.query("set local role authenticated");
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

/** Run a callback as a signed-out visitor: role `anon`, auth.uid() null. */
export async function asAnon<T>(db: Client, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', '', true)`);
    await db.query("set local role anon");
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

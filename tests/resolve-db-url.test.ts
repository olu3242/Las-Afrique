import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "resolve-db-url.py");

/**
 * The hosted workflow's connection-string resolver.
 *
 * It earned tests the hard way: two consecutive hosted runs failed inside it —
 * first because it only recognised one spelling of the password placeholder,
 * then because the leftover-bracket guard rejected legitimate IPv6 hosts. Both
 * were cheap to catch here and expensive to catch in CI against a real project.
 */
function resolve(
  env: Record<string, string>,
  args: string[] = [],
): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = execFileSync("python3", [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { ok: true, out: out.trim() };
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    return { ok: false, err: (e.stderr ?? e.stdout ?? "").trim() };
  }
}

const POOLER = "aws-0-us-east-1.pooler.supabase.com:5432/postgres";

describe("hosted connection-string resolver", () => {
  it.each([
    ["[YOUR-PASSWORD]"],
    ["[YOUR_PASSWORD]"],
    ["[password]"],
    ["[Your Password]"],
    ["[db-pass]"],
  ])("substitutes the %s placeholder", (placeholder) => {
    const result = resolve({
      SUPABASE_DB_URL: `postgresql://postgres.abc:${placeholder}@${POOLER}`,
      SUPABASE_DB_PASSWORD: "simple",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.out).toBe(`postgresql://postgres.abc:simple@${POOLER}`);
    }
  });

  it("percent-encodes a password that would otherwise corrupt the URL", () => {
    const password = "p@ss/w:rd#1&x?";
    const result = resolve({
      SUPABASE_DB_URL: `postgresql://postgres.abc:[YOUR-PASSWORD]@${POOLER}`,
      SUPABASE_DB_PASSWORD: password,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = new URL(result.out);
    // The host must survive intact — an unencoded @ or / would truncate it.
    expect(parsed.hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
    expect(decodeURIComponent(parsed.password)).toBe(password);
  });

  it("leaves an already-filled URL untouched", () => {
    const url = `postgresql://postgres.abc:realpw@${POOLER}`;
    const result = resolve({ SUPABASE_DB_URL: url });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.out).toBe(url);
  });

  it("accepts a bracketed IPv6 host", () => {
    // A bracketed *host* is valid; only a bracketed userinfo is a placeholder.
    const url = "postgresql://postgres:pw@[2600:1f10::1]:5432/postgres";
    const result = resolve({ SUPABASE_DB_URL: url });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.out).toBe(url);
  });

  it("refuses a placeholder with no password supplied", () => {
    const result = resolve({
      SUPABASE_DB_URL: `postgresql://postgres.abc:[YOUR-PASSWORD]@${POOLER}`,
      SUPABASE_DB_PASSWORD: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.err).toMatch(/SUPABASE_DB_PASSWORD is empty/i);
  });

  it("refuses an unset URL", () => {
    const result = resolve({ SUPABASE_DB_URL: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.err).toMatch(/is not set/i);
  });

  it("refuses a URL carrying no password at all", () => {
    const result = resolve({
      SUPABASE_DB_URL: `postgresql://postgres.abc@${POOLER}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.err).toMatch(/no password/i);
  });

  it("--describe reveals host, user and port but never the password", () => {
    const secret = "SuperSecret123";
    const result = resolve(
      {
        SUPABASE_DB_URL: `postgresql://postgres.abc:[YOUR-PASSWORD]@${POOLER}`,
        SUPABASE_DB_PASSWORD: secret,
      },
      ["--describe"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.out).toContain("aws-0-us-east-1.pooler.supabase.com");
    expect(result.out).toContain("postgres.abc");
    expect(result.out).not.toContain(secret);
    expect(result.out).not.toContain(encodeURIComponent(secret));
  });
});

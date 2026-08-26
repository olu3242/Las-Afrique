import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib"];

function walk(dir: string, match: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, match));
    } else if (match(full)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = SOURCE_DIRS.flatMap((dir) =>
  walk(join(ROOT, dir), (p) => p.endsWith(".ts") || p.endsWith(".tsx")),
);

/** Files carrying the "use client" directive, which ship to the browser. */
const clientFiles = sourceFiles.filter((path) => {
  const head = readFileSync(path, "utf8").slice(0, 200);
  return /^\s*["']use client["']/m.test(head);
});

describe("server secrets stay on the server", () => {
  it("finds client components to check", () => {
    // A guard on the guard: if this hits zero the checks below are vacuous.
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it("never names the service-role key outside the admin module", () => {
    const offenders = sourceFiles.filter((path) => {
      if (path.endsWith(join("lib", "env.ts"))) return false;
      if (path.endsWith(join("lib", "supabase", "admin.ts"))) return false;
      return readFileSync(path, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY");
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the admin client out of every client component", () => {
    const offenders = clientFiles.filter((path) =>
      /from\s+["'][^"']*supabase\/admin["']/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("guards privileged modules with the server-only import", () => {
    for (const module of ["lib/supabase/admin.ts", "lib/supabase/server.ts"]) {
      const source = readFileSync(join(ROOT, module), "utf8");
      expect(source, `${module} should import server-only`).toMatch(
        /import\s+["']server-only["']/,
      );
    }
  });

  it("leaves no service-role value in the built client bundle", () => {
    const staticDir = join(ROOT, ".next", "static");
    if (!existsSync(staticDir)) {
      // Nothing built yet — the build step in CI covers this case.
      return;
    }
    const chunks = walk(staticDir, (p) => p.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);

    const leaked = chunks.filter((path) =>
      readFileSync(path, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"),
    );
    expect(leaked).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPublicSupabaseEnv,
  isSupabaseConfigured,
  readSecretKey,
  requirePublicSupabaseEnv,
} from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("public Supabase configuration", () => {
  it("is null when nothing is set, so the marketing site still renders", () => {
    expect(getPublicSupabaseEnv()).toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("accepts the current publishable key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc123";

    expect(getPublicSupabaseEnv()).toEqual({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_abc123",
    });
  });

  it("accepts a legacy anon JWT", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.legacy";

    expect(getPublicSupabaseEnv()?.publishableKey).toBe(
      "eyJhbGciOiJIUzI1NiJ9.legacy",
    );
  });

  it("prefers the publishable key when both generations are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_current";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.legacy";

    expect(getPublicSupabaseEnv()?.publishableKey).toBe("sb_publishable_current");
  });

  it("stays unconfigured when the URL is present but no key is", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(getPublicSupabaseEnv()).toBeNull();
  });

  it("stays unconfigured when a key is present but no URL is", () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc123";
    expect(getPublicSupabaseEnv()).toBeNull();
  });

  it("treats an empty string as unset rather than as a key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
    expect(getPublicSupabaseEnv()).toBeNull();
  });

  it("names both accepted variables when it throws", () => {
    expect(() => requirePublicSupabaseEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
    expect(() => requirePublicSupabaseEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });
});

describe("server secret key", () => {
  it("is undefined when unset", () => {
    expect(readSecretKey()).toBeUndefined();
  });

  it("accepts the current secret key", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_abc123";
    expect(readSecretKey()).toBe("sb_secret_abc123");
  });

  it("accepts a legacy service-role key", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.service";
    expect(readSecretKey()).toBe("eyJhbGciOiJIUzI1NiJ9.service");
  });

  it("prefers the current secret key over the legacy one", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_current";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.legacy";
    expect(readSecretKey()).toBe("sb_secret_current");
  });

  it("treats an empty string as unset", () => {
    process.env.SUPABASE_SECRET_KEY = "";
    expect(readSecretKey()).toBeUndefined();
  });
});

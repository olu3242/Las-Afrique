"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Browser Supabase client. Carries only the anon key, so every query it makes is
 * subject to row-level security.
 */
export function createClient() {
  const { url, anonKey } = requirePublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}

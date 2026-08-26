"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Browser Supabase client. Carries only the publishable key, so every query it makes is
 * subject to row-level security.
 */
export function createClient() {
  const { url, publishableKey } = requirePublicSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}

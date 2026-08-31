import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A single shared Supabase client/auth session for the whole app. Custom
// templates and project sync are separate features (separate tables, RLS
// policies and migrations) but intentionally share one sign-in: running two
// independent GoTrueClient instances against the same storage key is
// unsupported by supabase-js and can desync auth state between them.

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}

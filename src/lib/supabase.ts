import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getValidSupabaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

// Static NEXT_PUBLIC_* property access ensures Next.js inlines public Supabase config into client bundles.
const supabaseUrl = getValidSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseClientConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Keep Supabase Auth tokens strictly in memory (never localStorage or sessionStorage).
export const supabase: SupabaseClient | null = isSupabaseClientConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function signOutSupabase(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore sign-out errors if no active Supabase session exists
  }
}

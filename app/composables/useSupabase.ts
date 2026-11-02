import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'

let browserClient: SupabaseClient<Database> | null = null

export function useSupabaseConfig() {
  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl
  const key = config.public.supabasePublishableKey
  return { url, key, configured: Boolean(url && key) }
}

/**
 * Browser client. The app runs as an SPA, so a module-scoped singleton is
 * safe and keeps one auth state across the session.
 */
export function useSupabaseClient(): SupabaseClient<Database> {
  const { url, key, configured } = useSupabaseConfig()
  if (!configured) {
    throw new Error('Supabase belum dikonfigurasi: isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY.')
  }
  if (!browserClient) {
    browserClient = createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  }
  return browserClient
}

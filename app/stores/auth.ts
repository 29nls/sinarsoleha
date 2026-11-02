import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Session } from '@supabase/supabase-js'
import type { ProfileRow, Role } from '~/types/database'
import { can, type Capability } from '~/utils/permissions'

export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'unconfigured'
  | 'anonymous'
  | 'authenticated'
  | 'error'

let authListenerStarted = false

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Terjadi kesalahan yang tidak dikenali.'
}

function describeSignInError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) return 'Email atau kata sandi salah.'
  if (normalized.includes('email not confirmed')) return 'Email belum dikonfirmasi.'
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Terlalu banyak percobaan masuk. Coba lagi beberapa saat.'
  }
  return message
}

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('idle')
  const session = ref<Session | null>(null)
  const profile = ref<ProfileRow | null>(null)
  const errorMessage = ref<string | null>(null)
  const initialized = ref(false)
  let initPromise: Promise<void> | null = null

  const role = computed<Role | null>(() => profile.value?.role ?? null)
  const isAuthenticated = computed(() => status.value === 'authenticated' && profile.value !== null)
  const email = computed(() => session.value?.user.email ?? null)
  const expiresAt = computed(() => session.value?.expires_at ?? null)

  function allows(capability: Capability): boolean {
    return can(role.value, capability)
  }

  async function loadProfile(userId: string): Promise<void> {
    const supabase = useSupabaseClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw new Error(`Gagal memuat profil: ${error.message}`)

    // Cast until Phase 2 replaces the hand-written Database type with
    // `supabase gen types` output; the selected columns match ProfileRow.
    const profileRow = data as ProfileRow | null
    if (!profileRow) {
      throw new Error('Profil pengguna tidak ditemukan. Minta owner membuat profil untuk akun ini.')
    }
    if (!profileRow.is_active) {
      throw new Error('Akun ini dinonaktifkan. Hubungi owner.')
    }
    profile.value = profileRow
  }

  async function applySession(nextSession: Session | null): Promise<void> {
    session.value = nextSession
    if (!nextSession) {
      profile.value = null
      if (status.value !== 'unconfigured') status.value = 'anonymous'
      return
    }
    try {
      await loadProfile(nextSession.user.id)
      status.value = 'authenticated'
      errorMessage.value = null
    } catch (error) {
      profile.value = null
      status.value = 'error'
      errorMessage.value = describeError(error)
    }
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initPromise) return initPromise

    initPromise = (async () => {
      const { configured } = useSupabaseConfig()
      if (!configured) {
        status.value = 'unconfigured'
        initialized.value = true
        return
      }

      status.value = 'loading'
      try {
        const supabase = useSupabaseClient()
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        await applySession(data.session)

        if (!authListenerStarted) {
          authListenerStarted = true
          supabase.auth.onAuthStateChange((_event, nextSession) => {
            void applySession(nextSession)
          })
        }
      } catch (error) {
        status.value = 'error'
        errorMessage.value = describeError(error)
      } finally {
        initialized.value = true
      }
    })()

    return initPromise
  }

  async function signIn(inputEmail: string, password: string): Promise<boolean> {
    errorMessage.value = null
    const { configured } = useSupabaseConfig()
    if (!configured) {
      status.value = 'unconfigured'
      errorMessage.value = 'Supabase belum dikonfigurasi.'
      return false
    }

    status.value = 'loading'
    try {
      const supabase = useSupabaseClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: inputEmail.trim(),
        password,
      })
      if (error) {
        status.value = 'error'
        errorMessage.value = describeSignInError(error.message)
        return false
      }
      await applySession(data.session)
      return isAuthenticated.value
    } catch (error) {
      status.value = 'error'
      errorMessage.value = describeError(error)
      return false
    }
  }

  async function signOut(): Promise<void> {
    try {
      const supabase = useSupabaseClient()
      await supabase.auth.signOut()
    } finally {
      session.value = null
      profile.value = null
      errorMessage.value = null
      status.value = 'anonymous'
    }
  }

  return {
    status,
    session,
    profile,
    errorMessage,
    initialized,
    role,
    isAuthenticated,
    email,
    expiresAt,
    allows,
    initialize,
    signIn,
    signOut,
  }
})

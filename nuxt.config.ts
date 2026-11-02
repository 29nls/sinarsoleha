import tailwindcss from '@tailwindcss/vite'

// Supabase values are public by design (publishable/anon key + project URL).
// The service_role key must never be mapped into runtimeConfig.public.
const supabaseUrl = process.env.SUPABASE_URL ?? ''
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? ''

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',

  // SPA: every read and write goes to Supabase under RLS, so server-side
  // rendering would add a second auth path without adding enforcement.
  ssr: false,
  devtools: { enabled: false },

  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },

  runtimeConfig: {
    public: {
      supabaseUrl,
      supabasePublishableKey,
    },
  },

  app: {
    head: {
      title: 'Toko Sinar Soleha POS',
      htmlAttrs: { lang: 'id' },
      meta: [
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
})

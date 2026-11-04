import tailwindcss from '@tailwindcss/vite'

// Supabase values are public by design (publishable/anon key + project URL).
// The service_role key must never be mapped into runtimeConfig.public.
const supabaseUrl = process.env.SUPABASE_URL ?? ''
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? ''

// Supabase is the only external origin this app talks to. Realtime needs the
// wss:// form of the same host, so derive it rather than hardcoding the ref.
const supabaseHost = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : ''
  } catch {
    return ''
  }
})()
const supabaseOrigins = supabaseHost
  ? [`https://${supabaseHost}`, `wss://${supabaseHost}`]
  : []

// The SPA shell ships three inline scripts (importmap, runtime config and the
// Nuxt payload), so 'unsafe-inline' is required for scripts. Everything else
// stays locked to 'self': no third-party CDNs, fonts or analytics are used.
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabaseOrigins.map((o) => ` ${o}`).join('')}`,
    `connect-src 'self' ${supabaseOrigins.join(' ')}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  // No includeSubDomains: the preview host lives on the shared vercel.app
  // domain, and pinning subdomains there is not ours to do. Enable it once a
  // dedicated production domain exists.
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

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

  // Security headers are declared here rather than in vercel.json so they are
  // host-agnostic and can be verified against a local Nitro server.
  routeRules: {
    '/**': { headers: securityHeaders },
  },
})

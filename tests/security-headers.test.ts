import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The headers live in nuxt.config.ts as a plain object. Rather than booting a
// server, this reads the source and asserts the directives that matter, so a
// careless edit that drops one fails here instead of silently shipping.
//
// Comments are stripped first: several explain what is deliberately NOT set,
// and matching those would make the assertions lie.
const source = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
const config = source
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')

// Directives are written both as "..." strings and as `...` template literals
// (the ones that interpolate the Supabase host), so both forms are captured as
// whole values. Matching single quotes would only catch the 'self' inside them.
function csp(): string {
  const start = config.indexOf("'Content-Security-Policy'")
  expect(start, 'Content-Security-Policy missing from nuxt.config.ts').toBeGreaterThan(-1)
  const block = config.slice(start, start + 1400)
  const directives = [
    ...block.matchAll(/"([a-z-]+(?:-src)? [^"]*)"/g),
    ...block.matchAll(/`([a-z-]+(?:-src)? [^`]*)`/g),
  ].map((m) => m[1])
  return directives.join('; ')
}

describe('security headers', () => {
  it('locks the default source to self', () => {
    expect(csp()).toContain("default-src 'self'")
  })

  it('forbids framing, plugins and base tag hijacking', () => {
    const policy = csp()
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
  })

  it('allows the Supabase API and its realtime socket', () => {
    const policy = csp()
    // Realtime subscribes over wss://, so https alone would break stock updates.
    expect(policy).toContain('connect-src')
    expect(policy).toContain("'self' ${supabaseOrigins.join(' ')}")
    expect(config).toContain('wss://${supabaseHost}')
    expect(config).toContain('https://${supabaseHost}')
  })

  it('does not allow any third-party script or style origin', () => {
    const policy = csp()
    expect(policy).not.toMatch(/script-src[^;]*https?:\/\//)
    expect(policy).not.toMatch(/style-src[^;]*https?:\/\//)
  })

  it('sends HSTS without pinning subdomains of a shared domain', () => {
    expect(config).toContain("'Strict-Transport-Security': 'max-age=31536000'")
    expect(config).not.toContain('includeSubDomains')
  })

  it('keeps the browser from guessing content types or leaking referrers', () => {
    expect(config).toContain("'X-Content-Type-Options': 'nosniff'")
    expect(config).toContain("'Referrer-Policy': 'strict-origin-when-cross-origin'")
    expect(config).toContain("'X-Frame-Options': 'DENY'")
  })

  it('applies the headers to every route', () => {
    expect(config).toContain("'/**': { headers: securityHeaders }")
  })
})

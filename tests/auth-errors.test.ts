import { describe, expect, it } from 'vitest'
import { describeSignInError } from '../app/stores/auth'

/**
 * The login screen must never show a raw Supabase message. A cashier seeing
 * "Invalid login credentials" or "Request rate limit reached" has no idea what
 * to do; worse, the raw text leaks which half of the credential pair was wrong.
 *
 * The rate-limit branch is not hypothetical: a probe against the preview project
 * produced a real 429 after 31 failed logins, and the message Supabase returned
 * there is what these cases pin down.
 */
describe('describeSignInError', () => {
  it('turns wrong credentials into one neutral sentence', () => {
    expect(describeSignInError('Invalid login credentials')).toBe('Email atau kata sandi salah.')
  })

  it('is case insensitive, because Supabase does not promise casing', () => {
    expect(describeSignInError('invalid login credentials')).toBe('Email atau kata sandi salah.')
    expect(describeSignInError('INVALID LOGIN CREDENTIALS')).toBe('Email atau kata sandi salah.')
  })

  it('explains an unconfirmed email instead of blaming the password', () => {
    expect(describeSignInError('Email not confirmed')).toBe('Email belum dikonfirmasi.')
  })

  it('recognises the rate limit wording Supabase actually returns', () => {
    // Both spellings have shipped in different Supabase versions.
    expect(describeSignInError('Request rate limit reached')).toContain('Terlalu banyak percobaan')
    expect(describeSignInError('Too many requests')).toContain('Terlalu banyak percobaan')
  })

  it('does not tell the user their password is wrong when it is only a rate limit', () => {
    // The costly failure mode: a cashier retries harder because we blamed them.
    const message = describeSignInError('Request rate limit reached')
    expect(message).not.toContain('kata sandi salah')
    expect(message).toContain('Coba lagi')
  })

  it('passes through unknown messages rather than swallowing them', () => {
    // Hiding an unrecognised error would make real outages undiagnosable.
    expect(describeSignInError('Database connection lost')).toBe('Database connection lost')
  })
})

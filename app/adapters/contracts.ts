/**
 * Phase 7 adapter contract. Every optional integration exposes the same
 * lifecycle so the cashier can ask "can I use this right now?" without
 * knowing which hardware or provider sits behind it.
 *
 * `available` means the adapter can run in this environment at all (for
 * example, a gateway needs a server runtime). `enabled` comes from the
 * feature flag and is controlled by the owner. The POS core only reads these
 * values; it never lets an adapter change prices, totals, or stock.
 */
export type AdapterStatus = 'off' | 'ready' | 'unavailable' | 'error'

export interface AdapterHealth {
  ok: boolean
  /** Operator-facing reason; never contains credentials. */
  message: string
}

export interface PluginAdapter {
  readonly key: string
  readonly enabled: boolean
  readonly available: boolean
  readonly status: AdapterStatus
  initialize(): Promise<void>
  healthCheck(): Promise<AdapterHealth>
  /** Short label for the cashier header, e.g. "Printer: browser". */
  describe(): string
}

export function statusFor(enabled: boolean, available: boolean, failed = false): AdapterStatus {
  if (failed) return 'error'
  // An owner turning a plugin off is the expected state, even when the
  // adapter could not run here anyway (e.g. a gateway in a static SPA).
  if (!enabled) return 'off'
  return available ? 'ready' : 'unavailable'
}

export function statusLabel(status: AdapterStatus): string {
  switch (status) {
    case 'ready':
      return 'Aktif'
    case 'off':
      return 'Nonaktif'
    case 'unavailable':
      return 'Tidak tersedia'
    default:
      return 'Gagal'
  }
}

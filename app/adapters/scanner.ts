import type { AdapterHealth, PluginAdapter } from './contracts'
import { statusFor } from './contracts'
import type { PublicConfig } from '~/types/plugins'

/**
 * Keyboard-wedge barcode scanner adapter. The device types the SKU like a
 * keyboard and ends with Enter (or Tab). A human typing is much slower, so the
 * buffer only accepts a code when every keystroke arrived within
 * `MAX_KEY_GAP_MS` and the code reached the configured minimum length.
 *
 * The adapter never touches the search field directly; it emits a completed
 * code and the cashier decides what to do with it.
 */
export const MAX_KEY_GAP_MS = 60
export const DEFAULT_MIN_LENGTH = 4
export const MAX_CODE_LENGTH = 64

export interface ScanBufferOptions {
  minLength: number
  suffix: 'enter' | 'tab'
  now?: () => number
}

export interface ScanBuffer {
  /** Feed one keydown; returns the completed code when the suffix arrives. */
  push(key: string, at?: number): string | null
  reset(): void
  pending(): string
}

export function createScanBuffer(options: ScanBufferOptions): ScanBuffer {
  const now = options.now ?? (() => Date.now())
  const suffixKey = options.suffix === 'tab' ? 'Tab' : 'Enter'
  const minLength = Math.max(1, Math.min(options.minLength, MAX_CODE_LENGTH))
  let buffer = ''
  let lastAt = 0

  function reset() {
    buffer = ''
    lastAt = 0
  }

  return {
    reset,
    pending: () => buffer,
    push(key: string, at = now()) {
      if (key === suffixKey) {
        const code = buffer.trim()
        reset()
        return code.length >= minLength ? code : null
      }
      // Modifier and navigation keys are not part of a barcode.
      if (key.length !== 1) return null

      if (lastAt && at - lastAt > MAX_KEY_GAP_MS) buffer = ''
      if (buffer.length >= MAX_CODE_LENGTH) {
        reset()
        return null
      }
      buffer += key
      lastAt = at
      return null
    },
  }
}

export interface ScannerAdapter extends PluginAdapter {
  suffix: 'enter' | 'tab'
  minLength: number
  /** Pure buffer so a caller can route raw keydown events into the adapter. */
  buffer: ScanBuffer
}

export function createScannerAdapter(
  enabled: boolean,
  config: PublicConfig,
): ScannerAdapter {
  const suffix = config.suffix === 'tab' ? 'tab' : 'enter'
  const parsed = Number(config.min_length)
  const minLength = Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.round(parsed), MAX_CODE_LENGTH)
    : DEFAULT_MIN_LENGTH

  return {
    key: 'hardware.barcode_scanner',
    enabled,
    available: true,
    get status() {
      return statusFor(enabled, true)
    },
    suffix,
    minLength,
    buffer: createScanBuffer({ minLength, suffix }),
    async initialize() {
      this.buffer.reset()
    },
    async healthCheck(): Promise<AdapterHealth> {
      return {
        ok: true,
        message: 'Scanner keyboard-wedge aktif di kolom pencarian.',
      }
    },
    describe() {
      return `Scanner: ${suffix === 'tab' ? 'Tab' : 'Enter'} · min ${minLength}`
    },
  }
}

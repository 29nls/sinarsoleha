import { describe, expect, it, vi } from 'vitest'
import { createScanBuffer, createScannerAdapter, MAX_KEY_GAP_MS } from '../app/adapters/scanner'
import { createPrinterAdapter } from '../app/adapters/printer'
import { createQrisAdapter } from '../app/adapters/qris'
import { createPluginRegistry, defaultFlags, flagConfig, flagEnabled } from '../app/adapters/registry'
import { statusFor, statusLabel } from '../app/adapters/contracts'
import type { FeatureFlag } from '../app/types/plugins'
import {
  defaultPublicConfig,
  parseFeatureFlag,
  sanitizePublicConfig,
  PLUGIN_DEFINITION_BY_KEY,
} from '../app/types/plugins'

function flag(key: FeatureFlag['key'], enabled: boolean, publicConfig: Record<string, unknown> = {}): FeatureFlag {
  return { key, enabled, publicConfig: publicConfig as FeatureFlag['publicConfig'], updatedAt: null }
}

describe('adapter status', () => {
  it('never reports ready when the adapter is off or unavailable', () => {
    expect(statusFor(false, true)).toBe('off')
    expect(statusFor(true, false)).toBe('unavailable')
    expect(statusFor(true, true)).toBe('ready')
    expect(statusFor(false, false, true)).toBe('error')
  })

  it('labels every status in Indonesian', () => {
    expect(statusLabel('off')).toBe('Nonaktif')
    expect(statusLabel('ready')).toBe('Aktif')
    expect(statusLabel('unavailable')).toBe('Tidak tersedia')
    expect(statusLabel('error')).toBe('Gagal')
  })
})

describe('barcode scan buffer', () => {
  it('returns the code only when the suffix arrives', () => {
    let clock = 0
    const buffer = createScanBuffer({ minLength: 4, suffix: 'enter', now: () => clock })
    for (const key of ['E', 'L', 'E', '-', 'K', '0', '0', '1']) {
      clock += 10
      expect(buffer.push(key, clock)).toBeNull()
    }
    clock += 10
    expect(buffer.push('Enter', clock)).toBe('ELE-K001')
  })

  it('ignores a code shorter than the minimum length', () => {
    const buffer = createScanBuffer({ minLength: 4, suffix: 'enter' })
    buffer.push('A')
    buffer.push('B')
    expect(buffer.push('Enter')).toBeNull()
    expect(buffer.pending()).toBe('')
  })

  it('drops the buffer when keystrokes are too far apart to be a scan', () => {
    const buffer = createScanBuffer({ minLength: 2, suffix: 'enter' })
    buffer.push('A', 0)
    buffer.push('B', 10)
    buffer.push('C', 10 + MAX_KEY_GAP_MS + 1)
    buffer.push('D', 20 + MAX_KEY_GAP_MS + 1)
    expect(buffer.push('Enter', 30 + MAX_KEY_GAP_MS + 1)).toBe('CD')
  })

  it('supports Tab as the suffix and ignores modifier keys', () => {
    const buffer = createScanBuffer({ minLength: 2, suffix: 'tab' })
    buffer.push('Shift')
    buffer.push('S')
    buffer.push('K')
    buffer.push('U')
    expect(buffer.push('Tab')).toBe('SKU')
  })

  it('reads suffix and minimum length from public config', () => {
    const adapter = createScannerAdapter(true, { suffix: 'tab', min_length: 6 })
    expect(adapter.suffix).toBe('tab')
    expect(adapter.minLength).toBe(6)
    expect(adapter.status).toBe('ready')
  })

  it('falls back to safe defaults for invalid config', () => {
    const adapter = createScannerAdapter(false, { suffix: 'weird', min_length: 'abc' })
    expect(adapter.suffix).toBe('enter')
    expect(adapter.minLength).toBe(4)
    expect(adapter.status).toBe('off')
  })
})

describe('printer adapter', () => {
  it('uses the browser print path and reports it as the fallback', async () => {
    const print = vi.fn()
    const adapter = createPrinterAdapter(true, { adapter: 'browser', paper_width: '58' }, print)

    const result = await adapter.print({
      receiptNo: 'SS-1',
      businessDate: '2026-11-04',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      grandTotal: 0,
      cashierName: 'Kasir',
      createdAt: null,
      status: 'completed',
    })

    expect(print).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
    expect(result.fallbackUsed).toBe(true)
    expect(adapter.paperWidth).toBe(58)
    expect(adapter.status).toBe('ready')
  })

  it('is unavailable when the bridge transport is selected', async () => {
    const adapter = createPrinterAdapter(true, { adapter: 'bridge' }, () => {})
    expect(adapter.status).toBe('unavailable')
    expect(adapter.available).toBe(false)
    expect((await adapter.healthCheck()).ok).toBe(false)
  })

  it('keeps the receipt on screen when printing throws', async () => {
    const adapter = createPrinterAdapter(true, {}, () => {
      throw new Error('no printer')
    })
    const result = await adapter.print({
      receiptNo: 'SS-1',
      businessDate: '2026-11-04',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      grandTotal: 0,
      cashierName: 'Kasir',
      createdAt: null,
      status: 'completed',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('tetap tampil')
    expect(adapter.status).toBe('error')
  })

  it('stays off until the flag is enabled', () => {
    const adapter = createPrinterAdapter(false, {})
    expect(adapter.status).toBe('off')
    expect(adapter.enabled).toBe(false)
  })
})

describe('qris adapter', () => {
  it('is never available in a browser-only build', async () => {
    const adapter = createQrisAdapter(true, { provider_label: 'Merchant App' })
    expect(adapter.status).toBe('unavailable')
    const result = await adapter.charge({ transactionRef: 'SS-1', amount: 1000 })
    expect(result.ok).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.providerReference).toBeNull()
  })

  it('reports ready only when a server runtime is explicitly available', () => {
    const adapter = createQrisAdapter(true, {}, true)
    expect(adapter.status).toBe('ready')
    expect(adapter.describe()).toBe('QRIS: manual')
  })
})

describe('plugin registry', () => {
  it('defaults every adapter to off', () => {
    const registry = createPluginRegistry(defaultFlags())
    expect(registry.list()).toHaveLength(3)
    for (const adapter of registry.list()) {
      expect(adapter.enabled).toBe(false)
      expect(adapter.status).not.toBe('ready')
    }
  })

  it('reads enabled state and config from the flags', () => {
    const flags = [
      flag('hardware.thermal_printer', true, { paper_width: '58' }),
      flag('hardware.barcode_scanner', true, { suffix: 'tab' }),
      flag('payment.qris_gateway', false, {}),
    ]
    const registry = createPluginRegistry(flags, { print: () => {} })

    expect(registry.printer.status).toBe('ready')
    expect(registry.printer.paperWidth).toBe(58)
    expect(registry.scanner.suffix).toBe('tab')
    expect(registry.qris.status).toBe('off')
    expect(registry.get('hardware.barcode_scanner')).toBe(registry.scanner)
  })

  it('treats a missing flag as off', () => {
    expect(flagEnabled([], 'hardware.thermal_printer')).toBe(false)
    expect(flagConfig([], 'hardware.thermal_printer')).toEqual({})
  })

  it('returns null for an unknown adapter key', () => {
    const registry = createPluginRegistry([])
    expect(registry.get('unknown.key' as never)).toBeNull()
  })
})

describe('public config sanitising', () => {
  const printer = PLUGIN_DEFINITION_BY_KEY['hardware.thermal_printer']

  it('drops secret-looking keys and unknown fields', () => {
    const config = sanitizePublicConfig(printer, {
      printer_name: 'Kasir 1',
      api_secret: 'should-not-survive',
      webhook_token: 'nope',
      unknown: 'x',
    })
    expect(config).toEqual({ printer_name: 'Kasir 1' })
  })

  it('rejects values outside a select list and truncates text', () => {
    const config = sanitizePublicConfig(printer, {
      adapter: 'magic',
      paper_width: '58',
      printer_name: 'x'.repeat(200),
    })
    expect(config.adapter).toBeUndefined()
    expect(config.paper_width).toBe('58')
    expect(String(config.printer_name)).toHaveLength(80)
  })

  it('only keeps primitive values', () => {
    const config = sanitizePublicConfig(printer, {
      printer_name: { nested: true },
      adapter: ['browser'],
    })
    expect(config).toEqual({})
  })

  it('provides a default select value for a fresh install', () => {
    expect(defaultPublicConfig(printer)).toMatchObject({ adapter: 'browser', paper_width: '58' })
  })

  it('ignores a flag row with an unknown key', () => {
    expect(
      parseFeatureFlag({
        feature_key: 'unknown.feature',
        enabled: true,
        public_config: {},
        updated_at: '2026-11-04T00:00:00Z',
        updated_by: null,
      }),
    ).toBeNull()
  })

  it('parses a known flag with sanitised config', () => {
    const parsed = parseFeatureFlag({
      feature_key: 'hardware.barcode_scanner',
      enabled: true,
      public_config: { suffix: 'tab', secret: 'x' },
      updated_at: '2026-11-04T00:00:00Z',
      updated_by: null,
    })
    expect(parsed).toMatchObject({
      key: 'hardware.barcode_scanner',
      enabled: true,
      publicConfig: { suffix: 'tab' },
    })
  })
})

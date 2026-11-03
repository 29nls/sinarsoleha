import type { AdapterHealth, PluginAdapter } from './contracts'
import { statusFor } from './contracts'
import type { PublicConfig } from '~/types/plugins'

/**
 * Thermal printer adapter. There is no local bridge installed in this store,
 * so the only working transport is the browser print dialog over the existing
 * receipt stylesheet. A bridge adapter can be added later behind the same
 * `print(receipt)` method without touching the cashier page.
 */
export interface PrinterReceipt {
  receiptNo: string
  businessDate: string
  items: Array<{
    sku: string
    name: string
    unit: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
  subtotal: number
  discountAmount: number
  grandTotal: number
  cashierName: string
  createdAt: string | null
  status: string
}

export interface PrintResult {
  ok: boolean
  message: string
  /** The receipt sheet stays on screen; printing never blocks checkout. */
  fallbackUsed: boolean
}

export interface PrinterAdapter extends PluginAdapter {
  paperWidth: 58 | 80
  print(receipt: PrinterReceipt): Promise<PrintResult>
}

export function createPrinterAdapter(
  enabled: boolean,
  config: PublicConfig,
  print: () => void = () => window.print(),
): PrinterAdapter {
  const adapterName = config.adapter === 'bridge' ? 'bridge' : 'browser'
  const paperWidth: 58 | 80 = config.paper_width === '58' ? 58 : 80
  const printerName = typeof config.printer_name === 'string' ? config.printer_name : ''
  let failed = false

  return {
    key: 'hardware.thermal_printer',
    enabled,
    // The browser transport always exists; a bridge without QZ Tray does not.
    available: adapterName === 'browser',
    get status() {
      return statusFor(enabled, adapterName === 'browser', failed)
    },
    paperWidth,
    async initialize() {
      failed = false
    },
    async healthCheck(): Promise<AdapterHealth> {
      if (adapterName === 'bridge') {
        return {
          ok: false,
          message: 'Bridge printer lokal belum terpasang. Gunakan cetak lewat browser.',
        }
      }
      return { ok: true, message: 'Cetak memakai dialog browser.' }
    },
    describe() {
      const target = printerName ? `${adapterName} · ${printerName}` : adapterName
      return `Printer: ${target} · ${paperWidth} mm`
    },
    async print() {
      try {
        print()
        return {
          ok: true,
          message: 'Dialog cetak dibuka. Periksa pratinjau sebelum mencetak.',
          fallbackUsed: true,
        }
      } catch {
        failed = true
        return {
          ok: false,
          message: 'Dialog cetak tidak dapat dibuka. Nota tetap tampil di layar.',
          fallbackUsed: true,
        }
      }
    },
  }
}

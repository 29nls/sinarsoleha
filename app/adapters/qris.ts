import type { AdapterHealth, PluginAdapter } from './contracts'
import { statusFor } from './contracts'
import type { PublicConfig } from '~/types/plugins'

/**
 * QRIS gateway adapter placeholder. A dynamic charge needs a trusted server
 * that holds the provider secret and receives the webhook; this app is built
 * as a static SPA, so the adapter reports `available: false` no matter what
 * the flag says. The manual QRIS flow stays in the cashier.
 */
export interface QrisChargeRequest {
  transactionRef: string
  amount: number
}

export interface QrisChargeResult {
  ok: boolean
  status: 'unavailable' | 'pending' | 'paid' | 'failed'
  message: string
  /** Never populated by this build: no provider call is made. */
  providerReference: null
}

export interface QrisAdapter extends PluginAdapter {
  providerLabel: string
  merchantName: string
  charge(request: QrisChargeRequest): Promise<QrisChargeResult>
  checkStatus(providerReference: string): Promise<QrisChargeResult>
}

export function createQrisAdapter(
  enabled: boolean,
  config: PublicConfig,
  serverRuntimeAvailable = false,
): QrisAdapter {
  const providerLabel = typeof config.provider_label === 'string' ? config.provider_label : ''
  const merchantName = typeof config.merchant_name === 'string' ? config.merchant_name : ''

  return {
    key: 'payment.qris_gateway',
    enabled,
    available: serverRuntimeAvailable,
    get status() {
      return statusFor(enabled, serverRuntimeAvailable)
    },
    providerLabel,
    merchantName,
    async initialize() {
      // Nothing to warm up: there is no provider client in the browser.
    },
    async healthCheck(): Promise<AdapterHealth> {
      if (!serverRuntimeAvailable) {
        return {
          ok: false,
          message:
            'Gateway dinamis memerlukan server Nitro untuk menyimpan secret dan menerima webhook. Aplikasi ini SPA, jadi gunakan QRIS manual.',
        }
      }
      return { ok: true, message: 'Gateway siap.' }
    },
    describe() {
      return providerLabel ? `QRIS: ${providerLabel} (manual)` : 'QRIS: manual'
    },
    async charge(): Promise<QrisChargeResult> {
      return {
        ok: false,
        status: 'unavailable',
        message:
          'Charge dinamis tidak dijalankan dari browser. Catat QRIS manual setelah verifikasi di aplikasi merchant.',
        providerReference: null,
      }
    },
    async checkStatus(): Promise<QrisChargeResult> {
      return {
        ok: false,
        status: 'unavailable',
        message: 'Status gateway tidak dapat dicek tanpa server tepercaya.',
        providerReference: null,
      }
    },
  }
}

/**
 * Phase 7 — optional integrations. The three keys below are the only rows
 * seeded in `feature_flags`; the POS core never depends on any of them.
 */
export const PLUGIN_KEYS = [
  'hardware.thermal_printer',
  'hardware.barcode_scanner',
  'payment.qris_gateway',
] as const

export type PluginKey = (typeof PLUGIN_KEYS)[number]

export type PublicConfigValue = string | number | boolean
export type PublicConfig = Record<string, PublicConfigValue>

export interface FeatureFlagRow {
  feature_key: string
  enabled: boolean
  public_config: unknown
  updated_at: string
  updated_by: string | null
}

export interface FeatureFlag {
  key: PluginKey
  enabled: boolean
  publicConfig: PublicConfig
  updatedAt: string | null
}

export interface PluginConfigField {
  key: string
  label: string
  kind: 'text' | 'number' | 'select'
  help: string
  options?: readonly string[]
  maxLength?: number
}

export interface PluginDefinition {
  key: PluginKey
  label: string
  summary: string
  /** What still works when the adapter is off, unavailable, or failing. */
  fallback: string
  configFields: readonly PluginConfigField[]
}

export const PLUGIN_DEFINITIONS: readonly PluginDefinition[] = [
  {
    key: 'hardware.thermal_printer',
    label: 'Printer thermal',
    summary:
      'Tombol cetak memakai adapter printer. Tanpa bridge lokal, nota tetap dicetak lewat dialog browser.',
    fallback: 'Checkout tetap tersimpan; nota dapat ditampilkan dan dicetak lewat browser.',
    configFields: [
      {
        key: 'adapter',
        label: 'Adapter',
        kind: 'select',
        options: ['browser', 'bridge'],
        help: 'Bridge lokal (mis. QZ Tray) belum terpasang di perangkat ini; pilih browser.',
      },
      {
        key: 'printer_name',
        label: 'Nama printer',
        kind: 'text',
        maxLength: 80,
        help: 'Label non-rahasia untuk operator, bukan kredensial.',
      },
      {
        key: 'paper_width',
        label: 'Lebar kertas (mm)',
        kind: 'select',
        options: ['58', '80'],
        help: 'Hanya memengaruhi tata letak cetak, bukan isi transaksi.',
      },
    ],
  },
  {
    key: 'hardware.barcode_scanner',
    label: 'Barcode scanner',
    summary:
      'Scanner keyboard-wedge mengetik SKU lalu Enter. Kasir tetap dapat mengetik atau menempel SKU secara manual.',
    fallback: 'Pencarian manual SKU/nama tetap tersedia tanpa perangkat apa pun.',
    configFields: [
      {
        key: 'suffix',
        label: 'Akhiran scan',
        kind: 'select',
        options: ['enter', 'tab'],
        help: 'Karakter yang dikirim perangkat setelah kode selesai.',
      },
      {
        key: 'min_length',
        label: 'Panjang kode minimum',
        kind: 'number',
        help: 'Kode lebih pendek diabaikan agar ketikan biasa tidak dianggap scan.',
      },
    ],
  },
  {
    key: 'payment.qris_gateway',
    label: 'Gateway QRIS',
    summary:
      'Adapter pembayaran terpisah untuk charge dinamis. Aplikasi ini berjalan sebagai SPA tanpa server runtime, jadi gateway dinamis belum dapat diaktifkan.',
    fallback: 'QRIS manual dan tunai tetap tersedia; kasir memverifikasi pembayaran di aplikasi merchant.',
    configFields: [
      {
        key: 'provider_label',
        label: 'Label provider',
        kind: 'text',
        maxLength: 60,
        help: 'Nama merchant/aplikasi yang dipakai kasir saat verifikasi manual.',
      },
      {
        key: 'merchant_name',
        label: 'Nama merchant',
        kind: 'text',
        maxLength: 80,
        help: 'Ditampilkan pada panduan pembayaran. Jangan simpan API key di sini.',
      },
    ],
  },
]

export const PLUGIN_DEFINITION_BY_KEY: Record<PluginKey, PluginDefinition> = {
  'hardware.thermal_printer': PLUGIN_DEFINITIONS[0]!,
  'hardware.barcode_scanner': PLUGIN_DEFINITIONS[1]!,
  'payment.qris_gateway': PLUGIN_DEFINITIONS[2]!,
}

export function isPluginKey(value: unknown): value is PluginKey {
  return typeof value === 'string' && (PLUGIN_KEYS as readonly string[]).includes(value)
}

const MAX_TEXT = 120
const SECRET_FIELD = /(secret|token|key|password|credential|signature|webhook)/i

/**
 * `public_config` is readable by every signed-in staff member, so the parser
 * drops unknown and secret-looking keys instead of trusting the database row.
 * Only primitive values survive; nested objects are not part of the contract.
 */
export function sanitizePublicConfig(
  definition: PluginDefinition,
  value: unknown,
): PublicConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
  const result: PublicConfig = {}

  for (const field of definition.configFields) {
    if (SECRET_FIELD.test(field.key)) continue
    const raw = source[field.key]
    if (raw === undefined || raw === null) continue
    // Arrays and objects are not part of the contract, even for a select whose
    // option list happens to match `String(value)`.
    if (typeof raw === 'object') continue

    if (field.kind === 'number') {
      const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) continue
      result[field.key] = Math.round(parsed)
      continue
    }

    if (field.kind === 'select') {
      const text = String(raw).trim()
      if (field.options?.includes(text)) result[field.key] = text
      continue
    }

    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
    const text = String(raw).trim().slice(0, field.maxLength ?? MAX_TEXT)
    if (text) result[field.key] = text
  }

  return result
}

export function defaultPublicConfig(definition: PluginDefinition): PublicConfig {
  const result: PublicConfig = {}
  for (const field of definition.configFields) {
    if (field.kind === 'select' && field.options?.[0]) result[field.key] = field.options[0]
  }
  return result
}

/** A flag row is usable only when its key is known; unknown rows are ignored. */
export function parseFeatureFlag(row: FeatureFlagRow): FeatureFlag | null {
  if (!isPluginKey(row.feature_key)) return null
  const definition = PLUGIN_DEFINITION_BY_KEY[row.feature_key]
  return {
    key: row.feature_key,
    enabled: row.enabled === true,
    publicConfig: sanitizePublicConfig(definition, row.public_config),
    updatedAt: row.updated_at ?? null,
  }
}

import type { FeatureFlag, PluginKey, PublicConfig } from '~/types/plugins'
import { PLUGIN_DEFINITION_BY_KEY } from '~/types/plugins'
import type { PluginAdapter } from './contracts'
import { createPrinterAdapter, type PrinterAdapter } from './printer'
import { createScannerAdapter, type ScannerAdapter } from './scanner'
import { createQrisAdapter, type QrisAdapter } from './qris'

/**
 * One registry for all optional adapters. The cashier and settings page ask
 * the registry for a plugin; they never import a concrete adapter. That keeps
 * the contract in one place and makes "plugin off" the default path.
 */
export interface PluginRegistry {
  printer: PrinterAdapter
  scanner: ScannerAdapter
  qris: QrisAdapter
  list(): PluginAdapter[]
  get(key: PluginKey): PluginAdapter | null
}

export interface RegistryOptions {
  /** The SPA has no Nitro server, so a gateway can never be available here. */
  serverRuntimeAvailable?: boolean
  print?: () => void
}

export function flagConfig(flags: FeatureFlag[], key: PluginKey): PublicConfig {
  return flags.find((flag) => flag.key === key)?.publicConfig ?? {}
}

export function flagEnabled(flags: FeatureFlag[], key: PluginKey): boolean {
  return flags.find((flag) => flag.key === key)?.enabled ?? false
}

export function createPluginRegistry(
  flags: FeatureFlag[],
  options: RegistryOptions = {},
): PluginRegistry {
  const printer = createPrinterAdapter(
    flagEnabled(flags, 'hardware.thermal_printer'),
    flagConfig(flags, 'hardware.thermal_printer'),
    options.print,
  )
  const scanner = createScannerAdapter(
    flagEnabled(flags, 'hardware.barcode_scanner'),
    flagConfig(flags, 'hardware.barcode_scanner'),
  )
  const qris = createQrisAdapter(
    flagEnabled(flags, 'payment.qris_gateway'),
    flagConfig(flags, 'payment.qris_gateway'),
    options.serverRuntimeAvailable ?? false,
  )

  const all: PluginAdapter[] = [printer, scanner, qris]

  return {
    printer,
    scanner,
    qris,
    list: () => all,
    get(key) {
      return all.find((adapter) => adapter.key === key) ?? null
    },
  }
}

/** Every flag starts OFF when the table has not been read yet. */
export function defaultFlags(): FeatureFlag[] {
  return (Object.keys(PLUGIN_DEFINITION_BY_KEY) as PluginKey[]).map((key) => ({
    key,
    enabled: false,
    publicConfig: {},
    updatedAt: null,
  }))
}

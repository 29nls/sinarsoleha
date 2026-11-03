import { describe, expect, it, vi } from 'vitest'
import {
  describeSettingsError,
  loadFeatureFlags,
  saveFeatureFlag,
} from '../app/services/settings'

type Result = { data: unknown; error: unknown }

function selectClient(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return builder
  }
  for (const method of ['select', 'order', 'eq', 'limit']) builder[method] = record(method)
  builder.returns = vi.fn().mockResolvedValue(result)

  return {
    client: { from: vi.fn().mockReturnValue(builder) } as never,
    calls,
  }
}

function rpcClient(result: Result) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as never, rpc }
}

describe('describeSettingsError', () => {
  it('translates permission failures', () => {
    expect(describeSettingsError('permission denied for function set_feature_flag'))
      .toBe('Hanya owner yang dapat mengubah pengaturan fitur.')
    expect(describeSettingsError('new row violates row-level security policy'))
      .toBe('Hanya owner yang dapat mengubah pengaturan fitur.')
  })

  it('translates missing feature and bad config', () => {
    expect(describeSettingsError('FEATURE_NOT_FOUND')).toContain('Fitur tidak ditemukan')
    expect(describeSettingsError('INVALID_CONFIG: Konfigurasi harus berupa objek JSON.'))
      .toContain('Konfigurasi tidak valid')
  })

  it('passes an unknown message through unchanged', () => {
    expect(describeSettingsError('network timeout')).toBe('network timeout')
  })
})

describe('loadFeatureFlags', () => {
  it('returns all three plugins in a stable order, filling missing rows as OFF', async () => {
    const { client } = selectClient({
      data: [
        {
          feature_key: 'hardware.barcode_scanner',
          enabled: true,
          public_config: { suffix: 'tab' },
          updated_at: '2026-11-04T00:00:00Z',
          updated_by: null,
        },
      ],
      error: null,
    })

    const flags = await loadFeatureFlags(client)

    expect(flags.map((row) => row.key)).toEqual([
      'hardware.thermal_printer',
      'hardware.barcode_scanner',
      'payment.qris_gateway',
    ])
    expect(flags[0]).toMatchObject({ enabled: false, publicConfig: {} })
    expect(flags[1]).toMatchObject({ enabled: true, publicConfig: { suffix: 'tab' } })
  })

  it('ignores an unknown flag key instead of exposing it to the UI', async () => {
    const { client } = selectClient({
      data: [
        {
          feature_key: 'future.feature',
          enabled: true,
          public_config: {},
          updated_at: '2026-11-04T00:00:00Z',
          updated_by: null,
        },
      ],
      error: null,
    })

    const flags = await loadFeatureFlags(client)

    expect(flags).toHaveLength(3)
    expect(flags.every((row) => !row.enabled)).toBe(true)
  })

  it('throws a translated error when the read is denied', async () => {
    const { client } = selectClient({
      data: null,
      error: { message: 'permission denied for table feature_flags' },
    })

    await expect(loadFeatureFlags(client)).rejects.toThrow('Hanya owner')
  })
})

describe('saveFeatureFlag', () => {
  it('calls the owner-only RPC with a sanitised config', async () => {
    const { client, rpc } = rpcClient({
      data: {
        feature_key: 'hardware.thermal_printer',
        enabled: true,
        public_config: { adapter: 'browser', paper_width: '58' },
        updated_at: '2026-11-04T00:00:00Z',
        updated_by: 'u-1',
      },
      error: null,
    })

    const flag = await saveFeatureFlag(client, 'hardware.thermal_printer', true, {
      adapter: 'browser',
      paper_width: '58',
      api_secret: 'must-not-leave-the-browser',
    } as never)

    expect(rpc).toHaveBeenCalledWith('set_feature_flag', {
      p_feature_key: 'hardware.thermal_printer',
      p_enabled: true,
      p_public_config: { adapter: 'browser', paper_width: '58' },
    })
    expect(flag).toMatchObject({ key: 'hardware.thermal_printer', enabled: true })
  })

  it('never sends a secret-looking field even if the form is tampered with', async () => {
    const { client, rpc } = rpcClient({
      data: {
        feature_key: 'payment.qris_gateway',
        enabled: true,
        public_config: { provider_label: 'Merchant' },
        updated_at: '2026-11-04T00:00:00Z',
        updated_by: 'u-1',
      },
      error: null,
    })

    await saveFeatureFlag(client, 'payment.qris_gateway', true, {
      provider_label: 'Merchant',
      webhook_secret: 'leak',
    } as never)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_public_config: { provider_label: 'Merchant' },
    })
  })

  it('throws a translated error when the RPC rejects a non-owner', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'OWNER_REQUIRED' },
    })

    await expect(saveFeatureFlag(client, 'hardware.barcode_scanner', true, {}))
      .rejects.toThrow('Hanya owner')
  })

  it('rejects an unrecognised RPC response instead of trusting it', async () => {
    const { client } = rpcClient({ data: { unexpected: true }, error: null })

    await expect(saveFeatureFlag(client, 'hardware.barcode_scanner', true, {}))
      .rejects.toThrow('Respons pengaturan tidak dikenali')
  })
})

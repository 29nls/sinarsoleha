import { onScopeDispose, ref } from 'vue'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import {
  STOCK_EVENT,
  STOCK_TOPIC,
  parseStockBroadcast,
  type StockBroadcast,
} from '~/utils/stock'

export type StockChannelStatus = 'idle' | 'connecting' | 'subscribed' | 'error'

type Client = SupabaseClient<Database>

export interface StockRealtimeOptions {
  /** Called for every valid stock message. */
  onStock: (event: StockBroadcast) => void
  /**
   * Called after a *re*-subscribe, so the caller can refetch the balances it
   * shows. Missed messages during a disconnect are never replayed.
   */
  onResync?: () => void
}

/**
 * Subscribes to the `store:stock` Broadcast topic (POS-03, NFR-04, ADR-009).
 *
 * The channel is private, so only an authenticated session can join. It is a
 * display sync only: checkout still validates stock in PostgreSQL, and a
 * dropped message just means the number on screen is stale until the next
 * refetch.
 */
export function useStockRealtime(client: Client, options: StockRealtimeOptions) {
  const status = ref<StockChannelStatus>('idle')
  let channel: RealtimeChannel | null = null
  let everSubscribed = false
  let disposed = false

  function resync() {
    if (disposed) return
    try {
      options.onResync?.()
    } catch {
      // A failed refetch must not tear down the channel; the next message or
      // the next reconnect tries again.
    }
  }

  function subscribe() {
    if (disposed || channel) return
    status.value = 'connecting'
    channel = client
      .channel(STOCK_TOPIC, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: STOCK_EVENT }, (message) => {
        const event = parseStockBroadcast(message?.payload)
        if (!event) return
        try {
          options.onStock(event)
        } catch {
          // A rendering error must not kill the subscription.
        }
      })
      .subscribe((state) => {
        if (disposed) return
        if (state === 'SUBSCRIBED') {
          status.value = 'subscribed'
          // supabase-js reconnects on its own; after any reconnect the local
          // numbers may be stale, so ask for a fresh read.
          if (everSubscribed) resync()
          everSubscribed = true
          return
        }
        status.value = 'error'
      })
  }

  function unsubscribe() {
    const current = channel
    channel = null
    status.value = 'idle'
    if (current) void client.removeChannel(current)
  }

  /** Called when the browser comes back online: refetch then resubscribe. */
  function reconnect() {
    if (disposed) return
    resync()
    if (!channel) subscribe()
  }

  function start() {
    if (disposed) return
    subscribe()
  }

  function stop() {
    disposed = true
    unsubscribe()
  }

  onScopeDispose(stop)

  return { status, start, stop, reconnect }
}

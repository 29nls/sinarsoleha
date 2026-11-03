<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useOpnameDetail } from '~/composables/useOpnameDetail'
import type { OpnameItemRow } from '~/types/opname'
import { isOpnameEditable, opnameStatusLabel } from '~/types/opname'
import { formatDateTime } from '~/utils/format'
import OpnameItemTable from '~/components/opname/OpnameItemTable.vue'
import OpnameActionPanel from '~/components/opname/OpnameActionPanel.vue'
import OpnameConflictPanel from '~/components/opname/OpnameConflictPanel.vue'
import OpnameCountDialog from '~/components/opname/OpnameCountDialog.vue'

definePageMeta({ capability: 'opname.count' })

const route = useRoute()
const auth = useAuthStore()
const client = useSupabaseClient()

const opnameId = computed(() => route.params.id as string)
const canApprove = computed(() => auth.allows('opname.approve'))

const detailState = useOpnameDetail({ client, opnameId })
const {
  detail,
  items,
  pendingItems,
  recountItems,
  discrepancyItems,
  openingBalanceItems,
  loading,
  error,
  actionError,
  actionNotice,
  busyAction,
  conflicts,
  postResult,
  count,
  submit,
  approve,
  post,
  cancel,
  clearFeedback,
} = detailState

useHead({
  title: () => (detail.value ? `${detail.value.opnameNo} · Stok Opname` : 'Stok Opname'),
})

type ItemFilter = 'all' | 'pending' | 'recount' | 'difference'

const filter = ref<ItemFilter>('all')

function setFilter(value: ItemFilter): void {
  filter.value = value
}

const visibleItems = computed(() => {
  if (filter.value === 'pending') {
    return items.value.filter((item) => item.countStatus === 'pending')
  }
  if (filter.value === 'recount') {
    return items.value.filter((item) => item.countStatus === 'needs_recount')
  }
  if (filter.value === 'difference') {
    return items.value.filter((item) => (item.differenceQty ?? 0) !== 0)
  }
  return items.value
})

const editable = computed(() => (detail.value ? isOpnameEditable(detail.value.status) : false))

// --- count dialog ----------------------------------------------------------

const countOpen = ref(false)
const activeItem = ref<OpnameItemRow | null>(null)

function openCount(item: OpnameItemRow): void {
  // Drop a failure from a previous item so the dialog never opens pre-filled
  // with someone else's error message.
  clearFeedback()
  activeItem.value = item
  countOpen.value = true
}

async function submitCount(payload: {
  physicalQty: number
  reasonCode: string | null
  reasonNote: string | null
}): Promise<void> {
  const item = activeItem.value
  if (!item) return
  const ok = await count(item, payload.physicalQty, payload.reasonCode, payload.reasonNote)
  if (ok) {
    countOpen.value = false
    activeItem.value = null
  }
}

async function handleSubmit(): Promise<void> {
  await submit()
}

async function handleApprove(): Promise<void> {
  await approve()
}

async function handlePost(): Promise<void> {
  await post()
}

async function handleCancel(reason: string): Promise<void> {
  await cancel(reason)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <NuxtLink to="/stock-opname" class="text-[12px] text-[var(--color-muted)] hover:underline">
            ← Stok Opname
          </NuxtLink>
        </div>
        <h1 class="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          <span v-if="detail" class="font-mono text-[16px]">{{ detail.opnameNo }}</span>
          <span v-else>Detail sesi</span>
          <span v-if="detail" class="tag">{{ opnameStatusLabel(detail.status) }}</span>
        </h1>
        <p v-if="detail" class="text-[12px] text-[var(--color-muted)]">
          Dibuat {{ formatDateTime(detail.createdAt) }}
          <span v-if="detail.scopeNote"> · {{ detail.scopeNote }}</span>
        </p>
      </div>
      <button class="btn" type="button" :disabled="loading" @click="detailState.load()">
        Muat ulang
      </button>
    </div>

    <div v-if="loading && !detail" class="panel p-8 text-center" role="status">Memuat sesi…</div>
    <div v-else-if="error" class="panel p-8 text-center text-[var(--color-danger)]" role="alert">
      {{ error }}
    </div>

    <template v-else-if="detail">
      <div v-if="!editable && detail.status !== 'posted'" class="notice">
        Sesi ini terkunci pada status {{ opnameStatusLabel(detail.status).toLowerCase() }}.
        Hitungan tidak dapat diubah lagi.
      </div>

      <OpnameConflictPanel :conflicts="conflicts" :post-result="postResult" />

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0 space-y-4">
          <section class="panel" aria-labelledby="opname-items-title">
            <div class="panel-head flex-wrap gap-2">
              <h2 id="opname-items-title" class="panel-title">Item opname</h2>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                <button
                  v-for="option in [
                    { value: 'all', label: `Semua (${items.length})` },
                    { value: 'pending', label: `Belum (${pendingItems.length})` },
                    { value: 'recount', label: `Ulang (${recountItems.length})` },
                    { value: 'difference', label: `Selisih (${discrepancyItems.length})` },
                  ]"
                  :key="option.value"
                  class="btn px-1.5 py-0.5 text-[11px]"
                  :class="filter === option.value ? 'bg-[var(--color-accent-soft)] border-[#bcd9d2] text-[#0b5a4f]' : ''"
                  type="button"
                  @click="setFilter(option.value as ItemFilter)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <OpnameItemTable
              :items="visibleItems"
              :loading="loading"
              :error="null"
              :editable="editable"
              :highlighted-ids="conflicts.map((conflict) => conflict.item_id)"
              @count="openCount"
            />

            <div class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
              {{ visibleItems.length }} dari {{ items.length }} item ditampilkan.
              <span v-if="openingBalanceItems.length > 0">
                {{ openingBalanceItems.length }} item tanpa stok sistem akan dicatat sebagai saldo awal.
              </span>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <OpnameActionPanel
            :detail="detail"
            :can-approve="canApprove"
            :busy="busyAction"
            :pending-count="pendingItems.length"
            :recount-count="recountItems.length"
            :discrepancy-count="discrepancyItems.length"
            :opening-balance-count="openingBalanceItems.length"
            :error="actionError"
            :notice="actionNotice"
            @submit="handleSubmit"
            @approve="handleApprove"
            @post="handlePost"
            @cancel="handleCancel"
          />
        </div>
      </div>

      <OpnameCountDialog
        :open="countOpen"
        :item="activeItem"
        :saving="busyAction === 'count'"
        :error="actionError"
        @close="countOpen = false"
        @submit="submitCount"
      />
    </template>
  </div>
</template>

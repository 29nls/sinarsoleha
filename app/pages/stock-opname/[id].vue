<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useOpnameDetail } from '~/composables/useOpnameDetail'
import type { OpnameItemContext, OpnameItemFilter, OpnameItemRow } from '~/types/opname'
import {
  OPNAME_PAGE_SIZES,
  isOpnameEditable,
  opnameStatusLabel,
} from '~/types/opname'
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
  total,
  page,
  pageSize,
  filter,
  searchInput,
  loading,
  itemsLoading,
  error,
  itemsError,
  actionError,
  actionNotice,
  busyAction,
  conflicts,
  postResult,
  totalPages,
  canGoPrevious,
  canGoNext,
  rangeStart,
  rangeEnd,
  hasFilters,
  pendingCount,
  recountCount,
  discrepancyCount,
  load,
  setPage,
  setPageSize,
  setFilter,
  resetFilters,
  fetchItemContext,
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

/** Labels read from the global counters, so a filter never changes the number. */
const filterOptions = computed<Array<{ value: OpnameItemFilter; label: string }>>(() => [
  { value: 'all', label: `Semua (${detail.value?.itemCount ?? 0})` },
  { value: 'pending', label: `Belum (${pendingCount.value})` },
  { value: 'recount', label: `Ulang (${recountCount.value})` },
  { value: 'difference', label: `Selisih (${discrepancyCount.value})` },
])

const editable = computed(() => (detail.value ? isOpnameEditable(detail.value.status) : false))

const emptyMessage = computed(() =>
  hasFilters.value
    ? 'Tidak ada item yang cocok dengan filter atau pencarian ini.'
    : 'Sesi ini tidak memiliki item.',
)

// --- count dialog ----------------------------------------------------------

const countOpen = ref(false)
const activeItem = ref<OpnameItemRow | null>(null)
const activeContext = ref<OpnameItemContext | null>(null)
const contextLoading = ref(false)

let contextRequest = 0

async function openCount(item: OpnameItemRow): Promise<void> {
  // Drop a failure from a previous item so the dialog never opens pre-filled
  // with someone else's error message.
  clearFeedback()
  activeItem.value = item
  activeContext.value = null
  countOpen.value = true

  // The dialog must show live stock, not the session snapshot: after a version
  // conflict the snapshot is history and the RPC will rebase to current stock.
  const currentRequest = ++contextRequest
  contextLoading.value = true
  const context = await fetchItemContext(item.id)
  if (currentRequest !== contextRequest) return
  activeContext.value = context
  contextLoading.value = false
}

watch(countOpen, (open) => {
  if (open) return
  // Closing invalidates an in-flight read so a late response cannot reopen a
  // stale context on the next item.
  contextRequest += 1
  contextLoading.value = false
  activeContext.value = null
  activeItem.value = null
})

async function submitCount(payload: {
  physicalQty: number
  reasonCode: string | null
  reasonNote: string | null
}): Promise<void> {
  const item = activeItem.value
  if (!item) return
  const ok = await count(item, payload.physicalQty, payload.reasonCode, payload.reasonNote)
  if (ok) countOpen.value = false
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
      <button class="btn" type="button" :disabled="loading" @click="load()">
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
              <span class="num text-[11px] text-[var(--color-muted)]">
                {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
              <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                <button
                  v-for="option in filterOptions"
                  :key="option.value"
                  class="btn px-1.5 py-0.5 text-[11px]"
                  :class="filter === option.value ? 'bg-[var(--color-accent-soft)] border-[#bcd9d2] text-[#0b5a4f]' : ''"
                  type="button"
                  :aria-pressed="filter === option.value"
                  @click="setFilter(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>

              <div class="ml-auto flex items-center gap-1.5">
                <label class="sr-only" for="opname-item-search">Cari SKU atau nama produk</label>
                <input
                  id="opname-item-search"
                  v-model="searchInput"
                  class="field w-[200px] py-1 text-[12px]"
                  type="search"
                  placeholder="Cari SKU / nama…"
                  autocomplete="off"
                >
                <button
                  v-if="hasFilters"
                  class="btn px-1.5 py-0.5 text-[11px]"
                  type="button"
                  @click="resetFilters"
                >
                  Reset
                </button>
              </div>
            </div>

            <OpnameItemTable
              :items="items"
              :loading="itemsLoading"
              :error="itemsError"
              :editable="editable"
              :highlighted-ids="conflicts.map((conflict) => conflict.item_id)"
              :empty-message="emptyMessage"
              @count="openCount"
            />

            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2">
              <p class="text-[11px] text-[var(--color-muted)]">
                Halaman {{ page }} dari {{ totalPages }} · {{ pageSize }} item per halaman
                <span v-if="detail.openingBalanceCount > 0">
                  · {{ detail.openingBalanceCount }} item tanpa stok sistem akan dicatat sebagai
                  saldo awal
                </span>
              </p>
              <div class="flex items-center gap-2">
                <label class="sr-only" for="opname-page-size">Item per halaman</label>
                <select
                  id="opname-page-size"
                  class="field w-auto py-1 text-[12px]"
                  :value="pageSize"
                  :disabled="itemsLoading"
                  @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="size in OPNAME_PAGE_SIZES" :key="size" :value="size">
                    {{ size }} / halaman
                  </option>
                </select>
                <button
                  class="btn px-2 py-1 text-[11px]"
                  type="button"
                  :disabled="!canGoPrevious || itemsLoading"
                  @click="setPage(page - 1)"
                >
                  Sebelumnya
                </button>
                <button
                  class="btn px-2 py-1 text-[11px]"
                  type="button"
                  :disabled="!canGoNext || itemsLoading"
                  @click="setPage(page + 1)"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <OpnameActionPanel
            :detail="detail"
            :can-approve="canApprove"
            :busy="busyAction"
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
        :context="activeContext"
        :context-loading="contextLoading"
        :saving="busyAction === 'count'"
        :error="actionError"
        @close="countOpen = false"
        @submit="submitCount"
      />
    </template>
  </div>
</template>

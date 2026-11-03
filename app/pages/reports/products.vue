<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useReports } from '~/composables/useReports'
import { csvFileName, toCsv } from '~/types/reports'
import { downloadCsv } from '~/utils/download'
import ReportsTabs from '~/components/reports/ReportsTabs.vue'
import ReportRangePicker from '~/components/reports/ReportRangePicker.vue'
import ProductSalesTable from '~/components/reports/ProductSalesTable.vue'

definePageMeta({ capability: 'report.sales' })
useHead({ title: 'Penjualan per produk · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()

const {
  range,
  preset,
  applyPreset,
  setRange,
  products,
  productsLoading,
  productsError,
  refresh,
} = useReports({ client, autoLoad: ['products'] })

function updateFrom(value: string): void {
  setRange({ from: value, to: range.value.to })
}

function updateTo(value: string): void {
  setRange({ from: range.value.from, to: value })
}

function exportProducts(): void {
  const rows = products.value?.rows ?? []
  const csv = toCsv(
    ['SKU', 'Produk', 'Satuan', 'Kuantitas', 'Nilai kotor', 'Diskon baris', 'Nilai bersih', 'Jumlah nota'],
    rows.map((row) => [
      row.sku,
      row.productName,
      row.unitLabel,
      row.quantitySold,
      row.grossSales,
      row.lineDiscount,
      row.netSales,
      row.transactionCount,
    ]),
  )
  downloadCsv(csvFileName('penjualan-per-produk', range.value), csv)
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Laporan</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Penjualan per produk dari snapshot baris transaksi. Baris legacy tanpa produk tetap
        dihitung memakai SKU snapshot agar tidak hilang dari laporan.
      </p>
    </div>

    <ReportsTabs />

    <ReportRangePicker
      :from="range.from"
      :to="range.to"
      :preset="preset"
      :loading="productsLoading"
      @update:from="updateFrom"
      @update:to="updateTo"
      @preset="applyPreset"
      @refresh="refresh"
    />

    <section class="panel" aria-labelledby="product-sales-title">
      <div class="panel-head">
        <h2 id="product-sales-title" class="panel-title">Penjualan per produk</h2>
        <div class="flex items-center gap-2">
          <span class="num text-[11px] text-[var(--color-muted)]">
            {{ (products?.rows.length ?? 0).toLocaleString('id-ID') }} produk ·
            {{ (products?.transactionCount ?? 0).toLocaleString('id-ID') }} nota
          </span>
          <button class="btn text-[11px]" type="button" :disabled="productsLoading || !products" @click="exportProducts">
            Ekspor CSV
          </button>
        </div>
      </div>
      <ProductSalesTable
        :rows="products?.rows ?? []"
        :loading="productsLoading"
        :error="productsError"
        :truncated="products?.truncated ?? false"
      />
    </section>

    <p class="notice notice-warn" role="note">
      Laporan ini belum menghitung margin. PRD mencatat 119 harga beli kosong dan tidak ada histori
      biaya per tanggal, sehingga laba kotor tidak dapat disajikan sebagai angka akurat.
    </p>

    <p class="text-[11px] text-[var(--color-muted)]">
      Akses: {{ auth.role === 'owner' ? 'owner' : 'akun Anda' }}. Kasir hanya melihat transaksi
      miliknya; laporan penuh membutuhkan peran owner.
    </p>
  </div>
</template>

import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ProductTable from '~/components/catalog/ProductTable.vue'
import type { CatalogProduct } from '~/types/catalog'

const baseProduct: CatalogProduct = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: 'TES-001',
  name: 'Meja Kayu',
  categoryId: 1,
  categoryName: 'Furnitur',
  unitId: 1,
  unitLabel: 'Pcs',
  unitCode: 'PCS',
  salePrice: 125000,
  stockOnHand: 10,
  lowStockThreshold: 2,
  isActive: true,
  reviewStatus: 'verified',
  purchaseCost: 90000,
  issues: [],
}

const baseProps = {
  products: [] as CatalogProduct[],
  loading: false,
  error: null as string | null,
  isOwner: true,
  page: 1,
  pageSize: 50,
  total: 0,
}

async function renderTable(overrides: Partial<typeof baseProps> = {}): Promise<string> {
  const app = createSSRApp({
    render: () => h(ProductTable, { ...baseProps, ...overrides }),
  })
  return renderToString(app)
}

describe('ProductTable', () => {
  it('renders a loading state without showing an empty result', async () => {
    const html = await renderTable({ loading: true })
    expect(html).toContain('Memuat produk')
    expect(html).not.toContain('Tidak ada produk yang cocok')
  })

  it('renders an empty state', async () => {
    const html = await renderTable()
    expect(html).toContain('Tidak ada produk yang cocok')
  })

  it('renders a product row with owner cost and data quality columns', async () => {
    const html = await renderTable({
      products: [
        {
          ...baseProduct,
          issues: [{ code: 'purchase_cost_missing', detail: null }],
        },
      ],
      total: 1,
    })
    expect(html).toContain('TES-001')
    expect(html).toContain('Meja Kayu')
    expect(html).toContain('Furnitur')
    expect(html).toContain('Harga beli')
    expect(html).toContain('Harga beli belum tersedia')
    expect(html).toContain('90.000')
  })

  it('does not render owner cost or issue columns for non-owners', async () => {
    const html = await renderTable({ products: [baseProduct], total: 1, isOwner: false })
    expect(html).not.toContain('Harga beli')
    expect(html).not.toContain('Masalah data')
    expect(html).not.toContain('90.000')
  })

  it('keeps null price and stock visibly unknown', async () => {
    const html = await renderTable({
      products: [
        {
          ...baseProduct,
          salePrice: null,
          stockOnHand: null,
          reviewStatus: 'stock_unknown',
        },
      ],
      total: 1,
    })
    expect(html).toContain('Harga jual belum tersedia')
    expect(html).toContain('Belum diketahui')
    expect(html).not.toContain('Rp 0')
  })

  it('flags negative stock', async () => {
    const html = await renderTable({
      products: [{ ...baseProduct, stockOnHand: -2 }],
      total: 1,
    })
    expect(html).toContain('Stok negatif')
    expect(html).toContain('-2')
  })
})

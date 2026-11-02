export type ProductReviewStatus =
  | 'verified'
  | 'stock_unknown'
  | 'negative_opening_stock'
  | 'price_missing'
  | 'review_required'

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  categoryId: number | null
  categoryName: string | null
  unitId: number
  unitLabel: string
  unitCode: string
  salePrice: number | null
  stockOnHand: number | null
  lowStockThreshold: number | null
  isActive: boolean
  reviewStatus: string
  purchaseCost: number | null
  issues: ProductIssue[]
}

export interface ProductIssue {
  code: string
  detail: string | null
}

export interface CategoryOption {
  id: number
  name: string
  isActive: boolean
}

export interface UnitOption {
  id: number
  code: string
  label: string
  isActive: boolean
}

export interface ProductFormValues {
  productId: string | null
  sku: string
  name: string
  categoryId: number | null
  unitId: number
  salePrice: string
  lowStockThreshold: string
  isActive: boolean
  reviewStatus: string
}

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>

export interface ProductListFilters {
  categoryId: number | null
  unitId: number | null
  active: 'all' | 'active' | 'inactive'
  missingPrice: boolean
  unknownStock: boolean
  negativeStock: boolean
  reviewStatus: string
}

export interface ProductListParams extends ProductListFilters {
  search: string
  page: number
  pageSize: number
}

export interface ProductListResult {
  products: CatalogProduct[]
  total: number
}

export interface CategoryFormValues {
  categoryId: number | null
  name: string
  isActive: boolean
}

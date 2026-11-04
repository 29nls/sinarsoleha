import type { Role } from '~/types/database'

/**
 * Feature capabilities mirror the PRD access matrix (section 4.3).
 * This map drives navigation and UI affordances only. PostgreSQL RLS and
 * SECURITY DEFINER RPCs remain the authority for every operation.
 */
export const CAPABILITIES = [
  'dashboard.view',
  'catalog.read',
  'catalog.manage',
  'cost.read',
  'sale.create',
  'sale.read.own',
  'sale.read.all',
  'sale.void',
  'inventory.read',
  'opname.create',
  'opname.count',
  'opname.approve',
  'stock.adjust',
  'report.sales',
  'report.stock',
  'settings.manage',
  'users.manage',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const OWNER_CAPABILITIES: readonly Capability[] = CAPABILITIES

const CASHIER_CAPABILITIES: readonly Capability[] = [
  'dashboard.view',
  'catalog.read',
  'sale.create',
  'sale.read.own',
]

const INVENTORY_CAPABILITIES: readonly Capability[] = [
  'dashboard.view',
  'catalog.read',
  'inventory.read',
  'opname.create',
  'opname.count',
  'stock.adjust',
  'report.stock',
]

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: OWNER_CAPABILITIES,
  cashier: CASHIER_CAPABILITIES,
  inventory_staff: INVENTORY_CAPABILITIES,
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role].includes(capability)
}

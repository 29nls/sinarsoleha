import { describe, expect, it } from 'vitest'
import { can, ROLE_CAPABILITIES } from '../app/utils/permissions'
import { APP_MODULES, availableModules } from '../app/utils/modules'

describe('role capability matrix', () => {
  it('gives the owner every defined capability', () => {
    for (const capability of ROLE_CAPABILITIES.owner) {
      expect(can('owner', capability)).toBe(true)
    }
  })

  it('keeps purchase cost, void and approvals away from a cashier', () => {
    expect(can('cashier', 'sale.create')).toBe(true)
    expect(can('cashier', 'sale.read.own')).toBe(true)
    expect(can('cashier', 'cost.read')).toBe(false)
    expect(can('cashier', 'sale.read.all')).toBe(false)
    expect(can('cashier', 'sale.void')).toBe(false)
    expect(can('cashier', 'opname.approve')).toBe(false)
  })

  it('lets warehouse staff count an opname but not approve or post it', () => {
    expect(can('inventory_staff', 'opname.create')).toBe(true)
    expect(can('inventory_staff', 'opname.count')).toBe(true)
    expect(can('inventory_staff', 'opname.approve')).toBe(false)
    expect(can('inventory_staff', 'inventory.read')).toBe(true)
    expect(can('inventory_staff', 'sale.create')).toBe(false)
  })

  it('denies everything without a role', () => {
    expect(can(null, 'dashboard.view')).toBe(false)
    expect(can(undefined, 'catalog.read')).toBe(false)
  })

  it('gates the opname approval capability to the owner', () => {
    expect(can('owner', 'opname.approve')).toBe(true)
    expect(can('inventory_staff', 'opname.approve')).toBe(false)
    expect(can('cashier', 'opname.approve')).toBe(false)
  })
})

describe('module registry', () => {
  it('publishes stock opname for roles that may count', () => {
    const opname = APP_MODULES.find((mod) => mod.key === 'stock-opname')
    expect(opname).toBeDefined()
    expect(opname?.available).toBe(true)
    expect(opname?.path).toBe('/stock-opname')
    expect(opname?.capability).toBe('opname.count')
  })

  it('shows stock opname to owners and warehouse staff but not cashiers', () => {
    const keys = (role: 'owner' | 'inventory_staff' | 'cashier') =>
      availableModules((capability) => can(role, capability)).map((mod) => mod.key)

    expect(keys('owner')).toContain('stock-opname')
    expect(keys('inventory_staff')).toContain('stock-opname')
    expect(keys('cashier')).not.toContain('stock-opname')
  })

  it('never advertises a module without a capability the role holds', () => {
    for (const role of ['owner', 'cashier', 'inventory_staff'] as const) {
      for (const mod of availableModules((capability) => can(role, capability))) {
        expect(can(role, mod.capability)).toBe(true)
      }
    }
  })
})

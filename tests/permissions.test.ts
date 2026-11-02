import { describe, expect, it } from 'vitest'
import { can, ROLE_CAPABILITIES } from '../app/utils/permissions'

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
    expect(can('inventory_staff', 'sale.create')).toBe(false)
  })

  it('denies everything without a role', () => {
    expect(can(null, 'dashboard.view')).toBe(false)
    expect(can(undefined, 'catalog.read')).toBe(false)
  })
})

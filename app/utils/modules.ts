import type { Capability } from './permissions'

export interface AppModule {
  key: string
  label: string
  path: string
  capability: Capability
  phase: number
  available: boolean
  description: string
}

/**
 * Single registry for navigation and the dashboard roadmap table.
 * A module appears in the sidebar only when it is implemented AND the current
 * role holds its capability, so no link ever points at a missing page.
 */
export const APP_MODULES: readonly AppModule[] = [
  {
    key: 'dashboard',
    label: 'Dasbor',
    path: '/dashboard',
    capability: 'dashboard.view',
    phase: 1,
    available: true,
    description: 'Sesi pengguna dan status implementasi.',
  },
  {
    key: 'products',
    label: 'Produk',
    path: '/products',
    capability: 'catalog.read',
    phase: 3,
    available: true,
    description: 'Katalog, kategori, satuan, harga, dan kualitas data.',
  },
  {
    key: 'cashier',
    label: 'Kasir',
    path: '/cashier',
    capability: 'sale.create',
    phase: 4,
    available: true,
    description: 'Keranjang, pembayaran tunai/QRIS, dan nota.',
  },
  {
    key: 'transactions',
    label: 'Riwayat Transaksi',
    path: '/cashier/transactions',
    capability: 'sale.read.own',
    phase: 4,
    available: true,
    description: 'Riwayat, detail, cetak ulang, dan pembatalan transaksi.',
  },
  {
    key: 'inventory',
    label: 'Inventaris',
    path: '/inventory',
    capability: 'inventory.read',
    phase: 5,
    available: true,
    description: 'Saldo stok, histori pergerakan, dan selisih opname.',
  },
  {
    key: 'stock-opname',
    label: 'Stok Opname',
    path: '/stock-opname',
    capability: 'opname.count',
    phase: 5,
    available: true,
    description: 'Sesi hitung fisik, selisih, dan persetujuan.',
  },
  {
    key: 'reports',
    label: 'Laporan',
    path: '/reports',
    capability: 'report.sales',
    phase: 6,
    available: true,
    description: 'Penjualan, pendapatan, dan selisih stok.',
  },
  {
    key: 'settings',
    label: 'Pengaturan',
    path: '/settings',
    capability: 'settings.manage',
    phase: 7,
    available: true,
    description: 'Fitur opsional: printer, scanner, dan gateway QRIS.',
  },
  {
    key: 'users',
    label: 'Pengguna',
    path: '/users',
    capability: 'users.manage',
    phase: 9,
    available: true,
    description: 'Nama, peran, dan status aktif profil staf.',
  },
  {
    key: 'audit',
    label: 'Audit Log',
    path: '/audit',
    capability: 'users.manage',
    phase: 9,
    available: true,
    description: 'Riwayat perubahan data yang ditulis server.',
  },
]

export function availableModules(roleCapabilities: (capability: Capability) => boolean): AppModule[] {
  return APP_MODULES.filter((mod) => mod.available && roleCapabilities(mod.capability))
}

#!/usr/bin/env node
/**
 * Menyelesaikan satu baris `review` pada run impor produk.
 *
 * RPC `public.resolve_product_import_review` bersifat owner-only dan memakai
 * `auth.uid()`. Karena itu ia TIDAK bisa dipanggil dari SQL Editor Supabase
 * (di sana `auth.uid()` bernilai NULL dan fungsi menolak dengan AUTH_REQUIRED).
 * Skrip ini login sebagai owner lewat publishable key, sama seperti
 * `scripts/product-import.mjs`, lalu memanggil RPC tersebut.
 *
 * Tanpa argumen tulis: hanya membaca dan mencetak baris `review` yang tersisa.
 *
 *   node scripts/import-review-resolve.mjs
 *   node scripts/import-review-resolve.mjs --run <uuid> --row 1305 \
 *     --action approve --sale-price 20000 --purchase-cost 9500 \
 *     --reason "Harga jual dikoreksi owner saat cutover"
 *
 * Skrip ini tidak pernah menyentuh stok, tidak menghapus apa pun, dan tidak
 * memakai `service_role`.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')

function readEnvFile(text) {
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#') || !entry.includes('=')) continue
    const separator = entry.indexOf('=')
    const key = entry.slice(0, separator).trim()
    const raw = entry.slice(separator + 1).trim()
    env[key] = raw.replace(/^["']|["']$/g, '')
  }
  return env
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (!flag.startsWith('--')) throw new Error(`Argumen tidak dikenal: ${flag}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Argumen ${flag} butuh nilai`)
    }
    args[flag.slice(2)] = value
    i += 1
  }
  return args
}

function requireOwnerAccount(env) {
  if (env.PRODUCT_IMPORT_EMAIL && env.PRODUCT_IMPORT_PASSWORD) {
    return { email: env.PRODUCT_IMPORT_EMAIL, password: env.PRODUCT_IMPORT_PASSWORD }
  }
  const file = path.join(ROOT, '.tmp', 'phase2b-accounts.json')
  const accounts = JSON.parse(readFileSync(file, 'utf8'))
  const owner = accounts.find((account) => account.role === 'owner')
  if (!owner) throw new Error('Akun owner tidak ditemukan di .tmp/phase2b-accounts.json')
  return { email: owner.email, password: owner.password }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = readEnvFile(readFileSync(path.join(ROOT, '.env'), 'utf8'))
  const url = env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY tidak ada di .env')
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    throw new Error(`Target bukan URL Supabase yang dikenal: ${url}`)
  }

  const account = requireOwnerAccount(env)
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const signIn = await client.auth.signInWithPassword(account)
  if (signIn.error) throw new Error(`Login owner gagal: ${signIn.error.message}`)

  const profile = await client
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', signIn.data.user.id)
    .single()
  if (profile.error) throw new Error(`Profil gagal dibaca: ${profile.error.message}`)
  if (profile.data.role !== 'owner' || profile.data.is_active !== true) {
    throw new Error(`Akun ${account.email} bukan owner aktif.`)
  }

  console.log(`Target : ${url}`)
  console.log(`Owner  : ${account.email} (${profile.data.id})`)

  // Tanpa --run: mode baca saja. Cari semua baris yang masih berstatus review.
  if (!args.run) {
    const rows = await client
      .from('product_import_rows')
      .select(
        'run_id, source_row_number, normalized_sku, name_raw, sale_price, purchase_cost, issue_codes',
      )
      .eq('validation_status', 'review')
      .order('source_row_number', { ascending: true })
      .limit(50)
    if (rows.error) throw new Error(`Gagal membaca baris: ${rows.error.message}`)

    if (rows.data.length === 0) {
      console.log('\nTidak ada baris berstatus review.')
      return
    }

    const byRun = new Map()
    for (const row of rows.data) {
      if (!byRun.has(row.run_id)) byRun.set(row.run_id, [])
      byRun.get(row.run_id).push(row)
    }
    for (const [runId, runRows] of byRun) {
      console.log(`\nRun ${runId} — ${runRows.length} baris review:`)
      for (const row of runRows) {
        console.log(
          `  baris ${row.source_row_number} | ${row.normalized_sku} | ${row.name_raw} | ` +
            `jual ${row.sale_price ?? 'NULL'} | beli ${row.purchase_cost ?? 'NULL'} | ` +
            `${(row.issue_codes ?? []).join(',') || '-'}`,
        )
      }
    }
    return
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.run)) {
    throw new Error('--run harus uuid run impor')
  }
  if (!args.row) throw new Error('--row wajib diisi (nomor baris sumber)')
  const rowNumber = Number.parseInt(args.row, 10)
  if (!Number.isInteger(rowNumber)) throw new Error('--row harus angka bulat')

  if (args.action !== 'approve' && args.action !== 'reject') {
    throw new Error("--action wajib diisi: 'approve' atau 'reject'")
  }
  if (args.action === 'reject' && !args.reason) {
    throw new Error('--reason wajib untuk aksi reject')
  }

  const optionalNumber = (flag) => {
    if (args[flag] === undefined) return null
    const value = Number(args[flag])
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${flag} harus angka >= 0`)
    return value
  }
  const salePrice = optionalNumber('sale-price')
  const purchaseCost = optionalNumber('purchase-cost')

  const { data, error } = await client.rpc('resolve_product_import_review', {
    p_run_id: args.run,
    p_source_row_number: rowNumber,
    p_action: args.action,
    p_sale_price: salePrice,
    p_purchase_cost: purchaseCost,
    p_reason: args.reason ?? null,
  })
  if (error) throw new Error(`resolve gagal: ${error.message}`)

  console.log('\nHasil resolve:')
  console.log(JSON.stringify(data, null, 2))

  if (args.action === 'reject') return

  // Setelah approve, baris menjadi `ready` tetapi BELUM masuk katalog.
  // JANGAN menutup dengan `product-import.mjs --apply`: skrip itu men-staging
  // ulang seluruh workbook, dan `stage_product_import_rows` menimpa baris yang
  // `product_id`-nya masih NULL — koreksi harga owner akan kembali menjadi
  // `review`. Jadi baris ini diimpor langsung di sini.
  const imported = await client.rpc('import_product_import_row', {
    p_run_id: args.run,
    p_source_row_number: rowNumber,
  })
  if (imported.error) throw new Error(`impor baris gagal: ${imported.error.message}`)
  console.log(`\nImpor baris ${rowNumber}: ${JSON.stringify(imported.data)}`)

  const remaining = await client
    .from('product_import_rows')
    .select('source_row_number', { count: 'exact', head: true })
    .eq('run_id', args.run)
    .eq('validation_status', 'ready')
    .is('product_id', null)
  if (remaining.error) throw new Error(`Sisa baris gagal dihitung: ${remaining.error.message}`)

  if ((remaining.count ?? 0) > 0) {
    console.log(`Sisa ${remaining.count} baris 'ready' belum diimpor; run dibiarkan running.`)
    return
  }

  const finished = await client.rpc('finish_product_import', {
    p_run_id: args.run,
    p_status: 'completed',
  })
  if (finished.error) throw new Error(`finish gagal: ${finished.error.message}`)
  console.log(
    `Run selesai: ${finished.data.status} ` +
      `(imported ${finished.data.imported_rows}/${finished.data.total_rows}, ` +
      `review ${finished.data.review_rows}, rejected ${finished.data.rejected_rows})`,
  )
}

main().catch((error) => {
  console.error(`GAGAL: ${error.message}`)
  process.exitCode = 1
})

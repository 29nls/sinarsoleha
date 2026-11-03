#!/usr/bin/env node
/**
 * Phase 3B product master import.
 *
 * Dry-run (default): reads the workbook and writes five reports to .tmp/.
 * Performs no Supabase calls and no operational writes.
 *
 *   node scripts/product-import.mjs --dry-run
 *   node scripts/product-import.mjs --dry-run --workbook .tmp/product-master.xlsx
 *
 * Apply (requires explicit owner approval, never run from the dry-run step):
 *   node scripts/product-import.mjs --apply [--limit N] [--batch N]
 *
 * Apply stages rows, creates missing categories through upsert_category,
 * imports READY rows one at a time through public.import_product_import_row,
 * and never sends stock fields. Re-running the same workbook resumes the
 * existing run and skips rows that already have a product_id.
 */
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  FIRST_DATA_ROW,
  HEADER_ROW,
  WORKSHEET,
  cellResult,
  cellText,
  classifyRow,
  csvCell,
  mapUnit,
  normalizeCategory,
  normalizeName,
  normalizeSku,
  parseMoney,
  parseQuantity,
} from './product-import-rules.mjs'

const ROOT = process.cwd()
const REPORT_FILES = {
  preview: 'product-import-preview.json',
  summary: 'product-import-summary.md',
  errors: 'product-import-errors.csv',
  categories: 'product-category-map.csv',
  units: 'product-unit-map.csv',
}

/** Baseline recorded in docs/00-phase-0-audit.md, section 1.2. */
const AUDIT_BASELINE = {
  sourceRows: 1361,
  rawCategories: 204,
  normalizedCategories: 203,
  stockPopulated: 1116,
  stockMissing: 245,
  stockNegative: 37,
  salePriceMissing: 28,
  purchaseCostMissing: 119,
  unitsRaw: 10,
  unitsNormalized: 8,
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : true
}

function readEnvFile(text) {
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#') || !entry.includes('=')) continue
    const separator = entry.indexOf('=')
    env[entry.slice(0, separator).trim()] = entry
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return env
}

function baselineDelta(actual, expected) {
  if (expected === undefined) return ''
  const delta = actual - expected
  return delta === 0 ? 'cocok' : `selisih ${delta > 0 ? '+' : ''}${delta}`
}

function buildCategoryMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const normalized = normalizeCategory(row.categoryRaw)
    if (!normalized) continue
    const entry = map.get(normalized) ?? {
      name: normalized,
      rawLabels: new Set(),
      rows: 0,
      action: 'create',
    }
    entry.rawLabels.add(row.categoryRaw)
    entry.rows += 1
    map.set(normalized, entry)
  }
  return [...map.values()]
    .map((entry) => ({
      normalized: entry.name,
      rawLabels: [...entry.rawLabels].sort(),
      rawVariants: entry.rawLabels.size,
      rows: entry.rows,
      action: entry.action,
      note: entry.rawLabels.size > 1 ? 'Beberapa label sumber menyatu setelah trim spasi.' : '',
    }))
    .sort((a, b) => a.normalized.localeCompare(b.normalized, 'en'))
}

function buildUnitMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const code = mapUnit(row.unitRaw)
    const key = row.unitRaw
    const entry = map.get(key) ?? {
      raw: row.unitRaw,
      code,
      rows: 0,
      action: code ? 'map' : 'review',
    }
    entry.rows += 1
    map.set(key, entry)
  }
  return [...map.values()].sort(
    (a, b) => (a.code ?? '~').localeCompare(b.code ?? '~', 'en') || a.raw.localeCompare(b.raw, 'en'),
  )
}

export async function readWorkbook(workbookPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(workbookPath)
  const sheet = workbook.getWorksheet(WORKSHEET)
  if (!sheet) {
    throw new Error(`Worksheet "${WORKSHEET}" tidak ditemukan di ${workbookPath}`)
  }

  const headers = Array.from({ length: 9 }, (_, index) => cellText(sheet.getRow(HEADER_ROW).getCell(index + 1)))
  const stockCellDefinition = sheet.getRow(HEADER_ROW).getCell(5).value
  const stockFormula =
    stockCellDefinition && typeof stockCellDefinition === 'object' && 'formula' in stockCellDefinition
      ? String(stockCellDefinition.formula)
      : ''

  const formulaWarnings = []
  if (/STOCK MASTER/i.test(stockFormula)) {
    const present = workbook.worksheets.some((worksheet) => worksheet.name.toUpperCase() === 'STOCK MASTER')
    if (!present) {
      formulaWarnings.push({
        cell: 'E2',
        range: 'E2:E9397',
        formula: stockFormula,
        issue: "Formula stok merujuk worksheet 'STOCK MASTER' yang tidak ada di workbook.",
      })
    }
  }

  const rows = []
  let lastDataRow = FIRST_DATA_ROW - 1
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const skuRaw = cellText(row.getCell(1))
    const nameRaw = cellText(row.getCell(2))
    if (!skuRaw && !nameRaw) continue
    lastDataRow = rowNumber
    rows.push({ rowNumber, row })
  }

  return { sheet, headers, stockFormula, formulaWarnings, rows, lastDataRow }
}

export function buildPlan({ rows, stockFormula }) {
  const skuSeen = new Map()
  const nameSeen = new Map()

  const base = rows.map(({ rowNumber, row }) => {
    const skuRaw = cellText(row.getCell(1))
    const nameRaw = cellText(row.getCell(2))
    const categoryRaw = cellText(row.getCell(3))
    const unitRaw = cellText(row.getCell(4))
    const stockRaw = cellText(row.getCell(5))
    const saleRaw = cellText(row.getCell(6))
    const costRaw = cellText(row.getCell(7))

    const sku = normalizeSku(skuRaw)
    const name = normalizeName(nameRaw)
    const category = normalizeCategory(categoryRaw)
    const unitCode = mapUnit(unitRaw)
    const sale = parseMoney(cellResult(row.getCell(6)))
    const cost = parseMoney(cellResult(row.getCell(7)))
    const stock = parseQuantity(cellResult(row.getCell(5)))

    if (sku) skuSeen.set(sku, (skuSeen.get(sku) ?? 0) + 1)
    if (name) nameSeen.set(name.toLowerCase(), (nameSeen.get(name.toLowerCase()) ?? 0) + 1)

    return {
      sourceRowNumber: rowNumber,
      skuRaw,
      sku,
      nameRaw,
      name,
      categoryRaw,
      category,
      unitRaw,
      unitCode,
      salePriceRaw: saleRaw,
      salePrice: sale.value,
      salePriceError: sale.error,
      purchaseCostRaw: costRaw,
      purchaseCost: cost.value,
      purchaseCostError: cost.error,
      stockRaw,
      stockSource: stock.value,
      stockError: stock.error,
      stockFormula,
      rawPayload: {
        kode_barang: skuRaw,
        nama_barang: nameRaw,
        kategori: categoryRaw,
        unit: unitRaw,
        stock: stockRaw,
        harga_jual: saleRaw,
        harga_beli: costRaw,
      },
      duplicateSku: false,
      duplicateNameCandidate: false,
    }
  })

  for (const row of base) {
    row.duplicateSku = (skuSeen.get(row.sku) ?? 0) > 1
    row.duplicateNameCandidate = (nameSeen.get(row.name.toLowerCase()) ?? 0) > 1
  }

  const prepared = base.map((row) => ({ ...row, ...classifyRow(row) }))
  const categories = buildCategoryMap(prepared)
  const units = buildUnitMap(prepared)

  return { rows: prepared, categories, units }
}

export function summarize(plan, source) {
  const rows = plan.rows
  const count = (predicate) => rows.filter(predicate).length
  const negativeRows = rows.filter((row) => row.stockSource !== null && row.stockSource < 0)
  return {
    generatedAt: new Date().toISOString(),
    source,
    totals: {
      sourceRows: rows.length,
      ready: count((row) => row.status === 'ready'),
      review: count((row) => row.status === 'review'),
      rejected: count((row) => row.status === 'rejected'),
      importedStatusReadyWithFlags: count((row) => row.status === 'ready' && row.issueCodes.length > 0),
      duplicateSkus: count((row) => row.duplicateSku),
      duplicateNameCandidates: count((row) => row.duplicateNameCandidate),
      unmappedCategories: count((row) => !row.category),
      unmappedUnits: count((row) => !row.unitCode),
      missingSalePrice: count((row) => row.salePrice === null && !row.salePriceError),
      missingPurchaseCost: count((row) => row.purchaseCost === null && !row.purchaseCostError),
      missingSourceStock: count((row) => row.stockSource === null && !row.stockError),
      negativeSourceStock: negativeRows.length,
      zeroSourceStock: count((row) => row.stockSource === 0),
      stockPopulated: count((row) => row.stockSource !== null),
      saleBelowCost: count((row) => row.issueCodes.includes('sale_below_cost')),
      formulaErrors: source.formulaWarnings.length,
      rawUnitLabels: new Set(rows.map((row) => row.unitRaw)).size,
      salePriceErrors: count((row) => Boolean(row.salePriceError)),
      purchaseCostErrors: count((row) => Boolean(row.purchaseCostError)),
      stockErrors: count((row) => Boolean(row.stockError)),
    },
    categories: plan.categories,
    units: plan.units,
  }
}

export function renderSummary(report, plan) {
  const totals = report.totals
  const baseline = AUDIT_BASELINE
  const reviewRows = plan.rows.filter((row) => row.status === 'review')
  const rejectedRows = plan.rows.filter((row) => row.status === 'rejected')

  const reviewLines = reviewRows.length
    ? reviewRows.map((row) => `| ${row.sourceRowNumber} | \`${row.sku}\` | ${row.name} | ${row.reviewReasons.join(' ')} |`)
    : ['| — | — | Tidak ada baris berstatus review. | — |']

  const rejectedLines = rejectedRows.length
    ? rejectedRows.map((row) => `| ${row.sourceRowNumber} | \`${row.skuRaw}\` | ${row.reviewReasons.join(' ')} | ${row.errors.map((error) => error.code).join(', ')} |`)
    : ['| — | — | Tidak ada baris ditolak. | — |']

  const attention = [
    ['Harga jual kosong (tetap NULL, status `price_missing`)', totals.missingSalePrice],
    ['Harga beli kosong (tetap NULL, tanpa baris biaya)', totals.missingPurchaseCost],
    ['Harga jual di bawah harga beli (`sale_below_cost`)', totals.saleBelowCost],
    ['Stok sumber negatif (tetap NULL operasional)', totals.negativeSourceStock],
    ['Stok sumber kosong (tetap NULL operasional)', totals.missingSourceStock],
  ]

  return `# Product Master Import — Dry-Run Summary

**Sumber:** \`${report.source.file}\` (SHA-256 \`${report.source.sha256}\`)
**Worksheet:** \`${report.source.worksheet}\`, header baris ${report.source.headerRow}, data baris ${report.source.firstDataRow}–${report.source.lastDataRow}
**Dibuat:** ${report.generatedAt}
**Mode:** dry-run — tidak ada operasi tulis ke Supabase.

## 1. Angka wajib

| # | Metrik | Nilai |
| --- | --- | --- |
| 1 | Total baris sumber | ${totals.sourceRows} |
| 2 | Baris valid (ready) | ${totals.ready} |
| 3 | Baris tidak valid (rejected) | ${totals.rejected} |
| 4 | SKU duplikat | ${totals.duplicateSkus} |
| 5 | Kandidat nama duplikat | ${totals.duplicateNameCandidates} |
| 6 | Kategori tidak terpetakan | ${totals.unmappedCategories} |
| 7 | Satuan tidak terpetakan | ${totals.unmappedUnits} |
| 8 | Harga jual kosong | ${totals.missingSalePrice} |
| 9 | Harga beli kosong | ${totals.missingPurchaseCost} |
| 10 | Stok sumber kosong | ${totals.missingSourceStock} |
| 11 | Stok sumber negatif | ${totals.negativeSourceStock} |
| 12 | Error formula | ${totals.formulaErrors} |
| 13 | Siap diimpor | ${totals.ready} |
| 14 | Perlu review manual (baris) | ${totals.review} |

Baris dengan status \`ready\` tetapi membawa flag kualitas data: ${totals.importedStatusReadyWithFlags}.

## 2. Rekonsiliasi dengan audit Phase 0

| Metrik | Audit | Dry-run | Status |
| --- | --- | --- | --- |
| Record produk | ${baseline.sourceRows} | ${totals.sourceRows} | ${baselineDelta(totals.sourceRows, baseline.sourceRows)} |
| Kategori mentah | ${baseline.rawCategories} | ${report.categories.reduce((sum, item) => sum + item.rawVariants, 0)} | ${baselineDelta(report.categories.reduce((sum, item) => sum + item.rawVariants, 0), baseline.rawCategories)} |
| Kategori setelah normalisasi | ${baseline.normalizedCategories} | ${report.categories.length} | ${baselineDelta(report.categories.length, baseline.normalizedCategories)} |
| Stok terisi | ${baseline.stockPopulated} | ${totals.stockPopulated} | ${baselineDelta(totals.stockPopulated, baseline.stockPopulated)} |
| Stok kosong | ${baseline.stockMissing} | ${totals.missingSourceStock} | ${baselineDelta(totals.missingSourceStock, baseline.stockMissing)} |
| Stok negatif | ${baseline.stockNegative} | ${totals.negativeSourceStock} | ${baselineDelta(totals.negativeSourceStock, baseline.stockNegative)} |
| Harga jual kosong | ${baseline.salePriceMissing} | ${totals.missingSalePrice} | ${baselineDelta(totals.missingSalePrice, baseline.salePriceMissing)} |
| Harga beli kosong | ${baseline.purchaseCostMissing} | ${totals.missingPurchaseCost} | ${baselineDelta(totals.missingPurchaseCost, baseline.purchaseCostMissing)} |
| Satuan mentah | ${baseline.unitsRaw} | ${totals.rawUnitLabels} | ${baselineDelta(totals.rawUnitLabels, baseline.unitsRaw)} |
| Kode satuan kanonik | ${baseline.unitsNormalized} | ${report.units.filter((item) => item.code).length} | ${baselineDelta(report.units.filter((item) => item.code).length, baseline.unitsNormalized)} |

## 3. Keputusan normalisasi

- SKU: trim + huruf besar untuk perbandingan; ejaan asli dipertahankan saat menulis produk.
- Nama: trim dan spasi ganda dirapatkan; tidak ada penggabungan otomatis.
- Kategori: trim spasi, ejaan dan kapitalisasi dipertahankan. ${report.categories.filter((item) => item.rawVariants > 1).length} label sumber menyatu dengan label lain setelah trim.
- Satuan: 10 ejaan sumber dipetakan ke ${report.units.filter((item) => item.code).length} kode kanonik. Tidak ada konversi satuan.
- Harga: \`numeric(14,2)\`, kosong tetap \`NULL\`, nilai negatif ditolak, lebih dari 2 desimal ditolak.
- Stok: \`numeric(14,3)\` hanya di staging. Tidak pernah masuk ke \`products.stock_on_hand\`.

## 4. Formula

${report.source.formulaWarnings.length === 0 ? 'Tidak ada formula yang merujuk worksheet hilang.' : report.source.formulaWarnings.map((warning) => `- \`${warning.cell}\` (${warning.range}) — ${warning.issue}`).join('\n')}

Formula stok adalah array formula yang di-spill; ExcelJS hanya menyimpan cached result per baris. Cached value tidak dipercaya dan tidak diimpor ke stok operasional.

## 5. Baris review (tidak diimpor otomatis)

| Baris | SKU | Nama | Alasan |
| --- | --- | --- | --- |
${reviewLines.join('\n')}

## 6. Baris ditolak

| Baris | SKU mentah | Alasan | Kode |
| --- | --- | --- | --- |
${rejectedLines.join('\n')}

## 7. Perhatian owner

| Item | Baris |
| --- | --- |
${attention.map(([label, value]) => `| ${label} | ${value} |`).join('\n')}

## 8. Batasan

- Dry-run tidak memanggil Supabase; angka di atas berasal dari workbook dan aturan lokal.
- Impor nyata belum dijalankan dan menunggu persetujuan eksplisit owner.
- \`stock_on_hand\` untuk seluruh produk hasil impor akan tetap \`NULL\`; saldo awal ditetapkan lewat opname fisik Phase 5.
`
}

export async function writeReports(report, plan, outDir) {
  await mkdir(outDir, { recursive: true })
  const preview = {
    generatedAt: report.generatedAt,
    mode: 'dry-run',
    source: report.source,
    totals: report.totals,
    categories: report.categories,
    units: report.units,
    rows: plan.rows.map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      sku: row.sku,
      skuRaw: row.skuRaw,
      name: row.name,
      nameRaw: row.nameRaw,
      category: row.category,
      categoryRaw: row.categoryRaw,
      unit: row.unitCode,
      unitRaw: row.unitRaw,
      salePrice: row.salePrice,
      salePriceRaw: row.salePriceRaw,
      purchaseCost: row.purchaseCost,
      purchaseCostRaw: row.purchaseCostRaw,
      stockSource: row.stockSource,
      stockRaw: row.stockRaw,
      stockFormula: row.stockFormula,
      status: row.status,
      reviewStatus: row.reviewStatus,
      issueCodes: row.issueCodes,
      errors: row.errors,
      reviewReasons: row.reviewReasons,
    })),
  }

  const errorLines = ['severity,source_row,sku,name,field,code,message']
  for (const row of plan.rows) {
    for (const error of row.errors) {
      errorLines.push(
        ['error', row.sourceRowNumber, row.sku, row.name, error.field, error.code, error.message]
          .map(csvCell)
          .join(','),
      )
    }
    const issueMeta = {
      stock_unknown: ['stock', 'Stok operasional belum ditetapkan; saldo sumber tidak diimpor.'],
      negative_stock: ['stock', `Stok sumber negatif (${row.stockRaw}); saldo operasional tetap NULL.`],
      sale_price_missing: ['sale_price', 'Harga jual kosong; tetap NULL sampai diisi owner.'],
      purchase_cost_missing: ['purchase_cost', 'Harga beli kosong; tetap NULL.'],
      sale_below_cost: ['sale_price', `Harga jual ${row.salePrice} di bawah harga beli ${row.purchaseCost}.`],
      category_unmapped: ['category', 'Kategori tidak terpetakan.'],
      unit_unmapped: ['unit', 'Satuan tidak terpetakan.'],
      duplicate_name: ['name', 'Nama sama dengan baris lain setelah normalisasi.'],
    }
    for (const code of row.issueCodes) {
      const [field, message] = issueMeta[code] ?? ['row', 'Data perlu perhatian.']
      errorLines.push(
        ['warning', row.sourceRowNumber, row.sku, row.name, field, code, message].map(csvCell).join(','),
      )
    }
  }

  const categoryLines = ['raw_label,normalized_name,source_rows,action,raw_variants,note']
  for (const category of report.categories) {
    for (const rawLabel of category.rawLabels) {
      categoryLines.push(
        [rawLabel, category.normalized, category.rows, category.action, category.rawVariants, category.note]
          .map(csvCell)
          .join(','),
      )
    }
  }

  const unitLines = ['raw_unit,canonical_code,source_rows,action']
  for (const unit of report.units) {
    unitLines.push([unit.raw, unit.code ?? '', unit.rows, unit.action].map(csvCell).join(','))
  }

  await Promise.all([
    writeFile(path.join(outDir, REPORT_FILES.preview), `${JSON.stringify(preview, null, 2)}\n`),
    writeFile(path.join(outDir, REPORT_FILES.summary), renderSummary(report, plan)),
    writeFile(path.join(outDir, REPORT_FILES.errors), `${errorLines.join('\n')}\n`),
    writeFile(path.join(outDir, REPORT_FILES.categories), `${categoryLines.join('\n')}\n`),
    writeFile(path.join(outDir, REPORT_FILES.units), `${unitLines.join('\n')}\n`),
  ])

  return preview
}

async function runDryRun() {
  const workbookPath = path.resolve(ROOT, String(argValue('--workbook', path.join('.tmp', 'product-master.xlsx'))))
  const outDir = path.resolve(ROOT, String(argValue('--out', '.tmp')))
  const buffer = await readFile(workbookPath)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const workbook = await readWorkbook(workbookPath)
  const plan = buildPlan(workbook)
  const source = {
    file: path.basename(workbookPath),
    sha256,
    bytes: buffer.length,
    worksheet: WORKSHEET,
    headerRow: HEADER_ROW,
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow: workbook.lastDataRow,
    headers: workbook.headers,
    stockFormula: workbook.stockFormula,
    formulaWarnings: workbook.formulaWarnings,
  }
  const report = summarize(plan, source)
  const preview = await writeReports(report, plan, outDir)

  console.log(`Workbook   ${source.file} (${source.bytes} byte, sha256 ${sha256.slice(0, 12)}…)`)
  console.log(`Baris      ${report.totals.sourceRows} (${source.firstDataRow}–${source.lastDataRow})`)
  console.log(`Ready      ${report.totals.ready}`)
  console.log(`Review     ${report.totals.review}`)
  console.log(`Rejected   ${report.totals.rejected}`)
  console.log(`Kategori   ${report.categories.length} (${report.categories.reduce((sum, item) => sum + item.rawVariants, 0)} label mentah)`)
  const unitCodes = new Set(report.units.filter((item) => item.code).map((item) => item.code))
  console.log(`Satuan     ${unitCodes.size} kode dari ${report.units.length} ejaan (${plan.rows.length} baris)`)
  console.log(`Laporan    ${path.relative(ROOT, outDir)}/{${Object.values(REPORT_FILES).join(',')}}`)
  console.log(`JSON rows  ${preview.rows.length}`)
}

function parseAccounts(env) {
  if (env.PRODUCT_IMPORT_EMAIL && env.PRODUCT_IMPORT_PASSWORD) {
    return { email: env.PRODUCT_IMPORT_EMAIL, password: env.PRODUCT_IMPORT_PASSWORD }
  }
  const file = path.join(ROOT, '.tmp', 'phase2b-accounts.json')
  const accounts = JSON.parse(readFileSync(file, 'utf8'))
  const owner = accounts.find((account) => account.role === 'owner')
  if (!owner) throw new Error('Akun owner tidak ditemukan di .tmp/phase2b-accounts.json')
  return { email: owner.email, password: owner.password }
}

async function callRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return typeof data === 'string' ? JSON.parse(data) : data
}

async function runApply() {
  const envText = await readFile(path.join(ROOT, '.env'), 'utf8')
  const env = readEnvFile(envText)
  const url = env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY tidak ada di .env')
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    throw new Error(`Target bukan URL Supabase yang dikenal: ${url}`)
  }

  const batchSize = Math.min(Number(argValue('--batch', 50)) || 50, 100)
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null
  const workbookPath = path.resolve(ROOT, String(argValue('--workbook', path.join('.tmp', 'product-master.xlsx'))))
  const buffer = await readFile(workbookPath)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const workbook = await readWorkbook(workbookPath)
  const plan = buildPlan(workbook)

  const account = parseAccounts(env)
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const signIn = await client.auth.signInWithPassword(account)
  if (signIn.error) throw new Error(`Login owner gagal: ${signIn.error.message}`)
  const profile = await client.from('profiles').select('id, role, is_active').eq('id', signIn.data.user.id).single()
  if (profile.error) throw new Error(`Profil owner gagal dibaca: ${profile.error.message}`)
  if (profile.data.role !== 'owner' || profile.data.is_active !== true) {
    throw new Error(`Akun ${account.email} bukan owner aktif.`)
  }
  console.log(`Target ${url}`)
  console.log(`Owner  ${account.email} (${profile.data.id})`)

  const units = await client.from('units_of_measure').select('id, code').order('code')
  if (units.error) throw new Error(`Satuan gagal dibaca: ${units.error.message}`)
  const unitByCode = new Map((units.data ?? []).map((unit) => [unit.code, unit.id]))
  const missingUnits = [...new Set(plan.rows.map((row) => row.unitCode).filter(Boolean))].filter(
    (code) => !unitByCode.has(code),
  )
  if (missingUnits.length > 0) throw new Error(`Satuan belum ada di database: ${missingUnits.join(', ')}`)

  const run = await callRpc(client, 'begin_product_import', {
    p_payload: {
      source_filename: path.basename(workbookPath),
      source_worksheet: WORKSHEET,
      source_sha256: sha256,
      source_row_count: plan.rows.length,
      notes: `Dry-run ready=${plan.rows.filter((row) => row.status === 'ready').length}`,
    },
  })
  console.log(`Run    ${run.id} (${run.status})`)

  const existing = await client.from('categories').select('id, name')
  if (existing.error) throw new Error(`Kategori gagal dibaca: ${existing.error.message}`)
  const categoryByName = new Map(
    (existing.data ?? []).map((category) => [normalizeCategory(category.name).toLowerCase(), category.id]),
  )
  const importableCategories = plan.categories.filter((category) => category.rows > 0)
  for (const category of importableCategories) {
    const lookup = category.normalized.toLowerCase()
    if (categoryByName.has(lookup)) continue
    const created = await callRpc(client, 'upsert_category', {
      p_payload: { name: category.normalized, is_active: true },
    })
    categoryByName.set(lookup, created.id)
    console.log(`Kategori dibuat: ${category.normalized}`)
  }

  const rowsInBatches = []
  for (let index = 0; index < plan.rows.length; index += batchSize) {
    rowsInBatches.push(plan.rows.slice(index, index + batchSize))
  }
  let staged = 0
  for (const batch of rowsInBatches) {
    const payload = batch.map((row) => ({
      source_row_number: row.sourceRowNumber,
      raw_payload: row.rawPayload,
      sku_raw: row.skuRaw || null,
      name_raw: row.nameRaw || null,
      category_raw: row.categoryRaw || null,
      unit_raw: row.unitRaw || null,
      sale_price_raw: row.salePriceRaw || null,
      purchase_cost_raw: row.purchaseCostRaw || null,
      stock_raw: row.stockRaw || null,
      stock_formula: row.stockFormula || null,
      normalized_sku: row.sku,
      normalized_name: row.name,
      normalized_category: row.category || null,
      unit_code: row.unitCode,
      category_id: row.category ? (categoryByName.get(row.category.toLowerCase()) ?? null) : null,
      sale_price: row.salePrice,
      purchase_cost: row.purchaseCost,
      stock_source: row.stockSource,
      validation_status: row.status,
      review_status: row.reviewStatus,
      issue_codes: row.issueCodes,
      error_messages: row.errors.map((error) => `${error.code}: ${error.message}`),
    }))
    const result = await callRpc(client, 'stage_product_import_rows', {
      p_run_id: run.id,
      p_rows: payload,
    })
    staged += Number(result.staged ?? 0)
  }
  console.log(`Staging ${staged} baris`)

  let imported = 0
  let rejectedDuringImport = 0
  let processed = 0
  for (;;) {
    const pending = await client
      .from('product_import_rows')
      .select('source_row_number, normalized_sku')
      .eq('run_id', run.id)
      .eq('validation_status', 'ready')
      .is('product_id', null)
      .order('source_row_number', { ascending: true })
      .limit(limit ? Math.max(limit - processed, 0) : batchSize)
    if (pending.error) throw new Error(`Baris staging gagal dibaca: ${pending.error.message}`)
    const rows = pending.data ?? []
    if (rows.length === 0) break
    for (const row of rows) {
      const result = await callRpc(client, 'import_product_import_row', {
        p_run_id: run.id,
        p_source_row_number: row.source_row_number,
      })
      processed += 1
      if (result.status === 'imported') imported += result.already_imported ? 0 : 1
      if (result.status === 'rejected') {
        rejectedDuringImport += 1
        console.error(`Ditolak saat impor: baris ${row.source_row_number} ${row.normalized_sku} — ${result.message}`)
      }
      if (processed % 25 === 0) console.log(`  ${processed} baris diproses (${imported} produk baru)`)
    }
    if (limit && processed >= limit) break
  }
  console.log(`Impor  ${imported} produk baru, ${rejectedDuringImport} ditolak`)

  const remaining = await client
    .from('product_import_rows')
    .select('source_row_number', { count: 'exact', head: true })
    .eq('run_id', run.id)
    .eq('validation_status', 'ready')
    .is('product_id', null)
  if (remaining.error) throw new Error(`Sisa baris gagal dihitung: ${remaining.error.message}`)

  if ((remaining.count ?? 0) > 0) {
    console.log(`Sisa ${remaining.count} baris ready; run dibiarkan running untuk resume.`)
  } else {
    const finished = await callRpc(client, 'finish_product_import', {
      p_run_id: run.id,
      p_status: 'completed',
    })
    console.log(`Run selesai: ${finished.status} (imported ${finished.imported_rows}/${finished.total_rows})`)
  }
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply')
if (process.argv.includes('--apply')) {
  await runApply()
} else if (dryRun) {
  await runDryRun()
}

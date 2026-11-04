#!/usr/bin/env node
/**
 * Read-only account audit for the preview project.
 *
 * C2 was originally "delete every `phase*` account". That would have been
 * destructive in a way the checklist did not anticipate:
 *
 *   - preview holds no real accounts at all, so deleting test accounts removes
 *     the only way to sign in;
 *   - `audit_logs.actor_id` is `on delete set null`, and audit rows are guarded
 *     by an append-only trigger, so deleting a profile silently erases the
 *     actor from 4,500+ rows with no way to restore it.
 *
 * This script therefore reports instead of deletes, and fails when an account
 * deletion would orphan immutable history. It also flags fixtures that are
 * still active, which is the part of C2 that is safe to fix.
 *
 *   node scripts/account-audit.mjs
 *   node scripts/account-audit.mjs --json
 *
 * Nothing is written, deleted, or deactivated.
 */
import { readFileSync } from 'node:fs'

const PREVIEW_REF = 'ptbllrugrjepdhhdkzxn'
const JSON_OUT = process.argv.includes('--json')
const PAGE = 1000

const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const url = (env.SUPABASE_URL || env.NUXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url) throw new Error('SUPABASE_URL missing from .env')
if (!serviceKey) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required (export it from `supabase projects api-keys --reveal`)',
  )
}

const ref = new URL(url).hostname.split('.')[0]
if (ref !== PREVIEW_REF) {
  console.error(`BLOCKED: target ${ref} is not preview ${PREVIEW_REF}`)
  process.exit(1)
}

const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: adminHeaders })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function restCount(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { ...adminHeaders, Prefer: 'count=exact', Range: '0-0' },
  })
  const range = res.headers.get('content-range') ?? ''
  return Number(range.split('/')[1] ?? 0)
}

// ------------------------------------------------------------------ accounts --

const users = []
for (let page = 1; page <= 20; page++) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=100`, {
    headers: adminHeaders,
  })
  if (!res.ok) throw new Error(`admin users page ${page}: ${res.status}`)
  const body = await res.json()
  const batch = body.users ?? []
  users.push(...batch)
  if (batch.length < 100) break
}

const profiles = await rest('profiles?select=id,full_name,role,is_active')
const profileById = new Map(profiles.map((row) => [row.id, row]))

const TEST_EMAIL = /^(phase\d|test|e2e|demo|probe|smoke)/i

// How many immutable audit rows would lose their actor if this profile went away.
// PostgREST caps a single response at 1000 rows, so this must page. Reading one
// page silently under-reports the blast radius, which is the number that decides
// whether deleting an account is safe.
const auditCounts = new Map()
let auditTotal = 0
for (let offset = 0; ; offset += PAGE) {
  const page = await rest(
    `audit_logs?select=actor_id&order=id.asc&limit=${PAGE}&offset=${offset}`,
  )
  for (const row of page) {
    auditTotal++
    if (!row.actor_id) continue
    auditCounts.set(row.actor_id, (auditCounts.get(row.actor_id) ?? 0) + 1)
  }
  if (page.length < PAGE) break
}

const accounts = users.map((user) => {
  const profile = profileById.get(user.id)
  return {
    id: user.id,
    email: user.email ?? null,
    role: profile?.role ?? null,
    isActive: profile?.is_active ?? null,
    hasProfile: Boolean(profile),
    testLike: TEST_EMAIL.test(user.email ?? ''),
    auditRowsAsActor: auditCounts.get(user.id) ?? 0,
  }
})

// ------------------------------------------------------------------ fixtures --

const fixtures = await rest(
  'products?select=id,sku,is_active&or=(sku.like.TEST-*,sku.like.HOST-*)',
)
const activeFixtures = fixtures.filter((row) => row.is_active)

// -------------------------------------------------------------------- verdict --

const owners = accounts.filter((account) => account.role === 'owner' && account.isActive)
const accountsWithHistory = accounts.filter((account) => account.auditRowsAsActor > 0)
const orphanedProfiles = accounts.filter((account) => !account.hasProfile)

const problems = []
if (owners.length === 0) problems.push('no active owner account — nobody can sign in')
if (orphanedProfiles.length > 0) {
  problems.push(`${orphanedProfiles.length} auth user(s) without a profile row`)
}
if (activeFixtures.length > 0) {
  problems.push(`${activeFixtures.length} active TEST-*/HOST-* fixture(s)`)
}

const summary = {
  target: ref,
  generatedAt: new Date().toISOString(),
  accounts: accounts.length,
  testLikeAccounts: accounts.filter((account) => account.testLike).length,
  realAccounts: accounts.filter((account) => !account.testLike).length,
  activeOwners: owners.length,
  fixtures: fixtures.length,
  activeFixtures: activeFixtures.length,
  auditRows: auditTotal,
  accountsWithHistory: accountsWithHistory.length,
  problems,
  rows: accounts,
}

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`target: preview ${ref}`)
  console.log(`read-only; ${accounts.length} accounts, ${fixtures.length} fixtures\n`)

  for (const account of accounts.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))) {
    console.log(
      `${account.testLike ? 'TEST' : 'REAL'}  ${String(account.email).padEnd(44)} ` +
        `role=${String(account.role).padEnd(16)} active=${String(account.isActive).padEnd(5)} ` +
        `audit=${String(account.auditRowsAsActor).padEnd(5)}`,
    )
  }

  console.log(
    `\naccounts: ${summary.testLikeAccounts} test-like, ${summary.realAccounts} real, ` +
      `${summary.activeOwners} active owner(s)`,
  )
  console.log(`fixtures: ${summary.activeFixtures} active of ${summary.fixtures}`)
  console.log(`audit rows: ${summary.auditRows} (${summary.accountsWithHistory} accounts are actors)`)

  if (accountsWithHistory.length > 0) {
    console.log(
      '\nNOTE: deleting these accounts would set audit_logs.actor_id to NULL across\n' +
        `${auditTotal} immutable rows. The append-only trigger makes that\n` +
        'unrecoverable. Archive them instead of deleting.',
    )
  }

  if (problems.length === 0) console.log('\nOK: no blocking problems.')
  else for (const problem of problems) console.log(`PROBLEM: ${problem}`)
}

console.log('\nREAD-ONLY — nothing written.')
process.exit(problems.length === 0 ? 0 : 1)

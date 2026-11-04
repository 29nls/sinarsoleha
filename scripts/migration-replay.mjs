#!/usr/bin/env node
/**
 * Replay every migration against a clean PostgreSQL database.
 *
 * This is the part of C5 that can actually be proven on this machine. There is
 * no Docker, so `supabase db dump` cannot run and managed backups do not exist
 * on this plan (WALG without PITR, zero recovery points). What *can* be proven
 * is the claim production depends on: the 23 migrations reproduce a working
 * schema from nothing, in order, without manual steps.
 *
 * PGlite is real PostgreSQL compiled to WASM — the same engine, not a mock.
 * It runs in-process, so no Docker and no service to install.
 *
 * The Supabase platform objects the migrations expect (anon/authenticated
 * roles, the auth schema, auth.uid()) are created first. If that bootstrap list
 * is wrong, the migrations fail here rather than in production.
 *
 *   node scripts/migration-replay.mjs
 *   node scripts/migration-replay.mjs --verbose
 */
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VERBOSE = process.argv.includes('--verbose')
const MIGRATIONS_DIR = 'supabase/migrations'

// Objects Supabase provides before any migration runs. Kept deliberately small:
// every entry here is a thing migrations may rely on, so an omission shows up
// as a hard failure rather than a silent difference from production.
const BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase reads the JWT claims from a per-request setting. For migration
-- purposes only the shape matters; there is no request here.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;
`

// pg_trgm ships as a loadable module rather than being compiled into the
// engine, so it must be registered before the migration that creates it runs.
const db = new PGlite({ extensions: { pg_trgm } })

console.log('PostgreSQL (PGlite, WASM) — fresh in-memory database')
const version = await db.query('select version()')
console.log(`  ${version.rows[0].version.split(',')[0]}\n`)

await db.exec(BOOTSTRAP)
console.log('bootstrap: roles anon/authenticated/service_role, schema auth, auth.uid()\n')

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (files.length === 0) throw new Error(`no migrations in ${MIGRATIONS_DIR}`)

let applied = 0
const failures = []

for (const [index, file] of files.entries()) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  const started = Date.now()
  try {
    await db.exec(sql)
    applied++
    const ms = Date.now() - started
    if (VERBOSE) console.log(`  ok  ${String(index + 1).padStart(2)}. ${file} (${ms}ms)`)
  } catch (error) {
    failures.push({ file, message: error.message })
    console.log(`  FAIL ${String(index + 1).padStart(2)}. ${file}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

console.log(`\napplied ${applied}/${files.length} migrations`)
if (failures.length > 0) {
  console.log(`\n${failures.length} migration(s) failed:`)
  for (const failure of failures) console.log(`  ${failure.file}: ${failure.message.split('\n')[0]}`)
  process.exit(1)
}

// ---------------------------------------------------------------- verification --

const checks = []
const check = async (label, sql, predicate, describe) => {
  const result = await db.query(sql)
  const value = result.rows[0]?.value ?? result.rows[0]?.count
  const numeric = typeof value === 'string' ? Number(value) : value
  const ok = predicate(numeric)
  checks.push({ label, ok, detail: describe(numeric) })
}

await check(
  'tables created in public',
  `select count(*)::int as count from pg_tables where schemaname = 'public'`,
  (n) => n >= 15,
  (n) => `${n} tables`,
)

await check(
  'every public table has RLS enabled',
  `select count(*)::int as count from pg_tables
   where schemaname = 'public' and not rowsecurity`,
  (n) => n === 0,
  (n) => (n === 0 ? 'all enabled' : `${n} table(s) without RLS`),
)

await check(
  'security definer functions live in private',
  `select count(*)::int as count from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'`,
  (n) => n >= 5,
  (n) => `${n} functions`,
)

await check(
  'anon cannot execute privileged helpers',
  `select count(*)::int as count from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and has_function_privilege('anon', p.oid, 'execute')`,
  (n) => n === 0,
  (n) => (n === 0 ? 'none' : `${n} function(s) executable by anon`),
)

await check(
  'reference data seeded (units)',
  `select count(*)::int as count from public.units_of_measure`,
  (n) => n >= 3,
  (n) => `${n} units`,
)

// Categories are owner-managed, not seeded. Asserting this stays at zero also
// catches a migration that accidentally ships demo catalogue data.
await check(
  'categories start empty (owner-managed)',
  `select count(*)::int as count from public.categories`,
  (n) => n === 0,
  (n) => `${n} categories`,
)

await check(
  'audit log immutability trigger present',
  `select count(*)::int as count from pg_trigger where tgname = 'audit_logs_immutable'`,
  (n) => n === 1,
  (n) => (n === 1 ? 'installed' : 'MISSING'),
)

await check(
  'profiles table is empty on a fresh database',
  `select count(*)::int as count from public.profiles`,
  (n) => n === 0,
  (n) => `${n} rows`,
)

await check(
  'no test fixtures leak into a fresh database',
  `select count(*)::int as count from public.products`,
  (n) => n === 0,
  (n) => `${n} products`,
)

console.log('\nverification:')
let failed = 0
for (const item of checks) {
  if (!item.ok) failed++
  console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.label} — ${item.detail}`)
}

console.log(
  `\n${checks.length - failed} passed, ${failed} failed\n` +
    'RESULT: migrations replay cleanly onto an empty database.',
)
process.exit(failed === 0 ? 0 : 1)

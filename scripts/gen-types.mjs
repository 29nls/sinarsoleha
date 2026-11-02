#!/usr/bin/env node
/**
 * Generate app/types/database.generated.ts from the real migrated schema.
 * PGlite exposes the PostgreSQL wire protocol, so the Supabase CLI can
 * introspect it without Docker or a hosted project.
 *
 * Run: npm run gen:types
 */
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const PORT = 54329
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`
const OUTPUT = path.join(ROOT, 'types', 'database.generated.ts')

const db = new PGlite({ extensions: { pg_trgm } })
let server

try {
  await db.exec(await readFile(path.join(ROOT, 'supabase', 'tests', 'local_bootstrap.sql'), 'utf8'))

  const migrationDir = path.join(ROOT, 'supabase', 'migrations')
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationDir, file), 'utf8'))
  }

  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' })
  await server.start()
  console.log(`PGlite listening on ${server.getServerConn()}`)

  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      `npx --no-install supabase gen types typescript --db-url "${DB_URL}" --schema public`,
      { shell: true },
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('supabase gen types timed out after 120s'))
    }, 120_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })

  if (result.code !== 0) {
    console.error(result.stdout)
    console.error(result.stderr)
    throw new Error(`supabase gen types exited with ${result.code}`)
  }
  if (!result.stdout.includes('export type Database')) {
    throw new Error(`unexpected generator output:\n${result.stdout.slice(0, 500)}`)
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, result.stdout)
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${result.stdout.length} bytes)`)
} finally {
  if (server) await server.stop().catch(() => {})
  await db.close().catch(() => {})
}

#!/usr/bin/env node
/**
 * Phase 8 — bundle secret audit.
 *
 * Scans the built client bundle (and the prerender server chunks) for
 * credentials that must never leave the server: service-role keys, Supabase
 * secret keys, and JWTs carrying the service_role claim.
 *
 * The scan is deliberately narrow so it stays useful: `sb_secret_` and
 * `sb_publishable_` appear as *string literals* inside @supabase/supabase-js
 * (it sniffs key prefixes), so only a full-looking key with 20+ characters
 * after the prefix is reported. Same for `service_role`, which is a normal
 * JWT claim name in the auth library.
 *
 * Run: npm run audit:bundle   (after `npm run build`)
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SCAN_ROOTS = ['.output/public', '.output/server']
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.txt', '.map'])

const RULES = [
  {
    id: 'supabase-secret-key',
    // A real secret key: sb_secret_ followed by at least 20 key characters.
    pattern: /sb_secret_[A-Za-z0-9_-]{20,}/g,
    why: 'Supabase secret key di bundle klien',
  },
  {
    id: 'service-role-env',
    // The variable name itself is fine; its *value* is not. Only flag when a
    // value is assigned next to it.
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'`]?[A-Za-z0-9._-]{16,}/g,
    why: 'service_role key tertanam sebagai nilai',
  },
  {
    id: 'service-role-jwt',
    pattern: /"role"\s*:\s*"service_role"/g,
    why: 'JWT dengan claim service_role',
  },
  {
    id: 'jwt-service-role-payload',
    // base64url payload of a JWT that decodes to a service_role claim.
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    why: 'JWT lengkap di bundle klien',
    validate: (match) => {
      try {
        const payload = JSON.parse(Buffer.from(match.split('.')[1], 'base64url').toString('utf8'))
        return payload?.role === 'service_role' || payload?.role === 'supabase_admin'
      } catch {
        return false
      }
    },
  },
]

async function walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full)
    }
  }
  return files
}

function excerpt(text, index, length) {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + length + 40)
  return text.slice(start, end).replace(/\s+/g, ' ')
}

const findings = []
let scannedFiles = 0
let scannedBytes = 0

for (const root of SCAN_ROOTS) {
  const absolute = path.join(ROOT, root)
  let info
  try {
    info = await stat(absolute)
  } catch {
    continue
  }
  if (!info.isDirectory()) continue

  for (const file of await walk(absolute)) {
    const text = await readFile(file, 'utf8')
    scannedFiles += 1
    scannedBytes += Buffer.byteLength(text)
    const relative = path.relative(ROOT, file).split(path.sep).join('/')

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0
      let match
      while ((match = rule.pattern.exec(text)) !== null) {
        if (rule.validate && !rule.validate(match[0])) continue
        findings.push({
          rule: rule.id,
          why: rule.why,
          file: relative,
          match: excerpt(text, match.index, match[0].length),
        })
      }
    }
  }
}

console.log('Audit bundle — pencarian kredensial server di output build')
console.log(`  folder : ${SCAN_ROOTS.join(', ')}`)
console.log(`  berkas : ${scannedFiles}`)
console.log(`  ukuran : ${(scannedBytes / 1024).toFixed(1)} kB teks`)

if (scannedFiles === 0) {
  console.error('\nTidak ada berkas untuk dipindai. Jalankan `npm run build` lebih dulu.')
  process.exitCode = 1
} else if (findings.length > 0) {
  console.error(`\n${findings.length} temuan:`)
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${finding.file}`)
    console.error(`      ${finding.why}`)
    console.error(`      …${finding.match}…`)
  }
  process.exitCode = 1
} else {
  console.log('\nOK — tidak ada service_role/secret key di output build.')
}

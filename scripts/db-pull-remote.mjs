#!/usr/bin/env node
/**
 * Pull the remote (production) D1 database into the local Miniflare D1 used by `npm run dev`.
 *
 * Usage:
 *   npm run db:pull          # interactive confirm before wiping local
 *   npm run db:pull -- --yes # skip confirm
 *
 * Requires: `npx wrangler login` (or valid Cloudflare API credentials).
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const DB_NAME = 'brainiac'
const LOCAL_D1_DIR = join(process.cwd(), '.wrangler', 'state', 'v3', 'd1')

const args = new Set(process.argv.slice(2))
const yes = args.has('--yes') || args.has('-y')
const keepDump = args.has('--keep-dump')

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${cmdArgs.join(' ')}`)
  }
  return res
}

function wrangler(cmdArgs, opts = {}) {
  return run('npx', ['wrangler', ...cmdArgs], opts)
}

async function confirmWipe() {
  if (yes) return true
  if (!existsSync(LOCAL_D1_DIR)) return true

  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(
      `This will REPLACE your local D1 at ${LOCAL_D1_DIR} with production data.\nContinue? [y/N] `,
    )
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

function countRows(dumpSql) {
  // Rough sanity counts from INSERT statements in the export.
  const tables = ['users', 'thoughts', 'tags', 'thought_tags', 'analysis_jobs', 'thought_moods']
  const counts = {}
  for (const table of tables) {
    const re = new RegExp(`INSERT\\s+INTO\\s+["\`]?${table}["\`]?\\s`, 'gi')
    const matches = dumpSql.match(re)
    counts[table] = matches ? matches.length : 0
  }
  return counts
}

async function main() {
  if (!(await confirmWipe())) {
    console.log('Aborted.')
    process.exit(0)
  }

  const tmp = mkdtempSync(join(tmpdir(), 'brainiac-d1-'))
  const dumpPath = join(tmp, `${DB_NAME}-remote.sql`)

  try {
    console.log(`\n1) Exporting remote D1 "${DB_NAME}"…`)
    wrangler(['d1', 'export', DB_NAME, '--remote', `--output=${dumpPath}`])

    const dumpSql = readFileSync(dumpPath, 'utf8')
    const counts = countRows(dumpSql)
    console.log('\nExport row estimates (INSERT statements):')
    for (const [table, n] of Object.entries(counts)) {
      console.log(`  ${table}: ${n}`)
    }

    if (keepDump) {
      const kept = join(process.cwd(), `.tmp-${DB_NAME}-remote.sql`)
      writeFileSync(kept, dumpSql)
      console.log(`\nKept dump at ${kept}`)
    }

    console.log('\n2) Clearing local D1 state…')
    rmSync(LOCAL_D1_DIR, { recursive: true, force: true })

    console.log('\n3) Importing dump into local D1…')
    // Full export includes schema + data (and d1_migrations), so a fresh local import
    // matches production without a separate migrations apply step.
    // Capture stdout: wrangler prints a huge per-statement JSON success blob.
    const importRes = wrangler(['d1', 'execute', DB_NAME, '--local', `--file=${dumpPath}`], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    const out = String(importRes.stdout ?? '')
    if (/commands executed successfully/i.test(out)) {
      const m = out.match(/(\d+)\s+commands executed successfully/i)
      console.log(m ? `Imported OK (${m[1]} statements).` : 'Imported OK.')
    } else if (out.trim()) {
      console.log(out.trim().slice(0, 500))
    }

    console.log('\nDone. Local D1 now mirrors remote.')
    console.log('Restart `npm run dev` if it was already running so it reopens the DB.')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

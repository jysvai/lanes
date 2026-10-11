// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai
//
// The same three tasks on the model and effort each session runs: Opus 5.5 at xhigh (main),
// Sonnet 5.5 at high (mid lane), Haiku 5.5 at medium (low lane), each in a fresh `claude -p`.
// Records Claude Code's own cost figure, wall time and turns, and grades the answer.
//
//   REPS=3 node bench.mjs <this repo> <out.json>        (CLAUDE_BIN=<path> to pick the claude)
//
// A rerun skips the runs out.json already has.
import { spawnSync } from 'node:child_process'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const [repo, out] = process.argv.slice(2)
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude'
const here = dirname(fileURLToPath(import.meta.url))
// the right answers, read off the repo as it is now
const ENV_NAMES = [...new Set([...readFileSync(join(repo, 'lanes/hooks/register.ts'), 'utf8').matchAll(/\$\.env\.get\('([A-Z_]+)'\)/g)].map(m => m[1]))].sort()
const TESTS = Number(String(spawnSync(CLAUDE, ['plugin', 'test', 'lanes'], { cwd: repo, encoding: 'utf8' }).stdout).match(/(\d+) pass/)?.[1])

const TASKS = [
  {
    id: 'inventory', kind: 'low', cwd: repo, tools: ['Read', 'Grep', 'Glob'],
    prompt: 'List every environment variable name that lanes/hooks/register.ts reads with $.env.get(...). One name per line, sorted, nothing else, then a last line "count: N".',
    check: text => {
      const names = new Set(text.match(/\b[A-Z][A-Z0-9_]{1,}\b/g) ?? [])
      const missing = ENV_NAMES.filter(n => !names.has(n))
      const count = Number(text.match(/count:\s*(\d+)/i)?.[1])

      return { ok: missing.length === 0 && count === ENV_NAMES.length, note: missing.length ? `missing ${missing.join(', ')}` : `count ${count}` }
    },
  },
  {
    id: 'verify', kind: 'mid', cwd: repo, tools: ['Bash(claude plugin test:*)', 'PowerShell(claude plugin test:*)', 'Read'],
    prompt: 'Run `claude plugin test lanes` in this repo and report the result as one line: "pass: N fail: M".',
    check: text => {
      const m = text.match(/pass:\s*(\d+)\s*fail:\s*(\d+)/i)

      return { ok: m !== null && Number(m[1]) === TESTS && m[2] === '0', note: m ? `pass ${m[1]} fail ${m[2]}` : 'no count' }
    },
  },
  {
    id: 'review', kind: 'mid', cwd: join(here, 'bench-review'), tools: ['Read'],
    prompt: 'Review pages.js for bugs. For each bug give the line number and a one-line fix. If a function is correct, say so in one line.',
    check: text => {
      const found = /i \+ size\b(?!\s*-)/.test(text) || /slice\(i,\s*i \+ size\)/.test(text) || (/\b13\b/.test(text) && /size - 1|- 1\)|off[- ]by[- ]one/i.test(text))

      return { ok: found, note: found ? 'found the slice bug on line 13' : 'missed the slice bug' }
    },
  },
]

const MODELS = [
  { role: 'main', model: 'claude-opus-5-5', effort: 'xhigh' },
  { role: 'mid', model: 'claude-sonnet-5-5', effort: 'high' },
  { role: 'low', model: 'claude-haiku-5-5', effort: 'medium' },
]

const REPS = Number(process.env.REPS ?? 1)
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
for (let rep = 0; rep < REPS; rep++) for (const task of TASKS) {
  for (const m of MODELS) {
    if (results.some(r => r.task === task.id && r.model === m.model && (r.rep ?? 0) === rep)) continue
    const started = Date.now()
    const run = spawnSync(CLAUDE, ['-p', task.prompt, '--model', m.model, '--effort', m.effort, '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools', ...task.tools, '--no-session-persistence'], {
      cwd: task.cwd, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024,
    })
    const wall = Date.now() - started
    let json = {}
    try { json = JSON.parse(run.stdout) } catch { json = { result: run.stdout?.slice(0, 500), error: run.stderr?.slice(0, 500) } }
    const text = String(json.result ?? '')
    const { ok, note } = task.check(text)
    results.push({
      task: task.id, rep, kind: task.kind, role: m.role, model: m.model, effort: m.effort,
      ok, note, cost: json.total_cost_usd ?? null, durationMs: json.duration_ms ?? wall, turns: json.num_turns ?? null,
      usage: json.usage ?? null, answer: text.slice(0, 1200),
    })
    writeFileSync(out, JSON.stringify(results, null, 1))
    console.log(`${task.id} ${m.model}: ${ok ? 'OK' : 'WRONG'} (${note}) $${json.total_cost_usd ?? '?'} ${Math.round((json.duration_ms ?? wall) / 1000)}s`)
  }
}

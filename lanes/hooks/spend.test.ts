// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Project "demo" on Windows, its files in memory; each model request answers with `usage`.
function ground(on: On, files: Record<string, string>, env: Record<string, string>, usage: Record<string, unknown> | null) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me', ...env })
  mock.clock(on)
  // on macOS a C:/ path isn't absolute and comes resolved against the plugin's folder
  const key = (p: string) => p.replaceAll('\\', '/').replace(/^.*\/(?=[A-Za-z]:\/)/, '')
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', ($, e) => ({ value: Object.keys(files).some(f => f.startsWith(key(e.path))) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => (key(e.path) in files ? { value: files[key(e.path)] ?? '' } : { deny: 'no such file' }))
  on('fs.write', ($, e) => {
    files[key(e.path)] = e.text

    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'lane' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__lanes__send' } }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
}

async function request($: Engine, model: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, effort: 'high', messageCount: 3 })
  for await (const _ of stream) {
    // drain
  }
}

// the clock starts at 0, so "today" is the local date of the epoch
const d = new Date(0)
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const spendOf = (files: Record<string, string>, role: string) => JSON.parse(files[`C:/work/demo/.claude/lanes/state/${role}.spend.json`] ?? '{}')[today]

test('a lane logs what each request cost and what the main model would have charged for it', async ($, on) => {
  const files: Record<string, string> = {}
  // a million cached tokens read and 10k written out: $0.10 + $0.10 on Sonnet 5.5, $0.20 + $0.20 on Opus 5.5
  ground(on, files, { CLAUDE_LANE: 'mid' }, { model: 'claude-sonnet-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 10_000 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-sonnet-5-5')
  await request($, 'claude-sonnet-5-5')

  const s = spendOf(files, 'mid')
  expect(s.calls).toBe(2)
  expect(s.cacheRead).toBe(2_000_000)
  expect(s.cost.toFixed(2)).toBe('0.40')
  expect(s.onMain.toFixed(2)).toBe('0.80')
})

test('a request a gateway answers under a name of its own is priced by the model it asked for', async ($, on) => {
  const files: Record<string, string> = {}
  const arn = 'arn:aws:bedrock:ap-northeast-2:123456789012:application-inference-profile/a1b2c3'
  ground(on, files, { CLAUDE_LANE: 'mid' }, { model: arn, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 10_000 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-sonnet-5-5')

  const s = spendOf(files, 'mid')
  expect(s.unpriced).toBe(0)
  expect(s.cost.toFixed(2)).toBe('0.20')
  expect(s.onMain.toFixed(2)).toBe('0.40')
})

test("a lane's requests also add up on the task it is on", async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files, { CLAUDE_LANE: 'mid' }, { model: 'claude-sonnet-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 10_000 })
  on('turn.start', ($, e) => e as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: '[T3] run the tests' } as never)
  await request($, 'claude-sonnet-5-5')
  await request($, 'claude-sonnet-5-5')

  const task = JSON.parse(files['C:/work/demo/.claude/lanes/state/mid.tasks.json'] ?? '{}').T3
  expect(task.calls).toBe(2)
  expect(task.cost.toFixed(2)).toBe('0.40')
  expect(task.onMain.toFixed(2)).toBe('0.80')
})

test('Haiku 5.5 is priced higher on a request whose prompt is over 100k tokens', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files, { CLAUDE_LANE: 'low' }, { model: 'claude-haiku-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 200_000, output_tokens: 0 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-haiku-5-5')

  // 200k cached tokens at $0.05 per million, not $0.01
  expect(spendOf(files, 'low').cost.toFixed(4)).toBe('0.0100')
})

test('a claude -p run started inside a lane logs nothing', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files, { CLAUDE_LANE: 'mid' }, { model: 'claude-haiku-5-5', input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: false })
  await request($, 'claude-haiku-5-5')

  expect(spendOf(files, 'mid')).toBeUndefined()
})

test('/lane usage counts the main session from its start, before any lane has opened here', async ($, on) => {
  // a project that has never used the lanes: no state folder
  const files: Record<string, string> = {}
  ground(on, files, {}, { model: 'claude-opus-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 0 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  const ran = await $.command.run({ command: 'lane', args: 'usage' } as never)

  expect(ran.text).toContain('  main  opus-5-5           1 calls     $0.20')
  // nothing written in a project that hasn't used the lanes
  expect(files['C:/work/demo/.claude/lanes/state/main.spend.json']).toBeUndefined()
})

test('/lane usage adds up the main session and the lanes and says what the lanes saved', async ($, on) => {
  const day = (cost: number, onMain: number, calls: number) =>
    JSON.stringify({ [today]: { calls, unpriced: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost, onMain } })
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/main.spend.json': day(43.94, 43.94, 468),
    'C:/work/demo/.claude/lanes/state/mid.spend.json': day(26.15, 52.3, 767),
    'C:/work/demo/.claude/lanes/state/low.spend.json': day(0.52, 9.81, 147),
  }
  ground(on, files, {}, null)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'usage' } as never)

  expect(ran.text).toContain(`lane spend today (${today})`)
  expect(ran.text).toContain('  mid   sonnet-5-5       767 calls    $26.15   on opus-5-5 $52.30  saved $26.15 (50%)')
  expect(ran.text).toContain('  lanes                  914 calls    $26.67   on opus-5-5 $62.11  saved $35.44 (57%)')
})

test('/lane usage says where the saving came from: each task, the price gap, what main never read', async ($, on) => {
  const spent = JSON.stringify({ [today]: { calls: 25, unpriced: 0, input: 2000, cacheWrite: 310_000, cacheRead: 2_000_000, output: 30_000, cost: 1.12, onMain: 2.98 } })
  const task = (lane: string, goal: string, cost: number, onMain: number, verdict: string) => ({ lane, goal, started: 0, ended: 60_000, verdict, calls: 5, cost, onMain })
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/mid.spend.json': spent,
    'C:/work/demo/.claude/lanes/state/mid.tasks.json': JSON.stringify({ T1: task('mid', 'review the uncommitted changes', 1.0, 2.0, 'PASS') }),
    'C:/work/demo/.claude/lanes/state/low.tasks.json': JSON.stringify({ T2: task('low', 'list the session names', 0.02, 0.78, 'DONE') }),
  }
  ground(on, files, {}, null)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''

  expect(text).toContain('where it came from, by task (most saved first)\n  T1    mid  PASS      $1.00 instead of   $2.00  saved  $1.00  review the uncommitted changes\n  T2    low  DONE      $0.02 instead of   $0.78  saved  $0.76  list the session names')
  expect(text).toContain('  lane time outside a task (opening, notes): $0.10')
  expect(text).toContain('per token, sonnet-5-5 costs 1/2 of opus-5-5, haiku-5-5 costs 1/40–1/20 of opus-5-5')
  expect(text).toContain('the lanes took in 312k tokens')
})

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Project "demo" on Windows, its files in memory; each model request answers with `usage`.
function ground(on: On, files: Record<string, string>, env: Record<string, string>, usage: Record<string, unknown> | null | (() => Record<string, unknown>)) {
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
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: typeof usage === 'function' ? usage() : usage } as never
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

test("a restart or a plugin reload before the project's first lane keeps what main has spent so far", async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files, {}, { model: 'claude-opus-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 0 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  // the plugin reloads: session.start fills the module's variables again
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')

  expect((await $.command.run({ command: 'lane', args: 'usage' } as never)).text).toContain('  main  opus-5-5           2 calls     $0.40')
  // kept in the user's folder, still nothing in the project
  expect(Object.keys(files).some(f => /^C:\/Users\/me\/\.claude\/lanes\/demo-[0-9a-f]{4}\/main\.spend\.json$/.test(f))).toBe(true)
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

test('a day logged at $0 because a gateway named every model its own way is priced from its tokens', async ($, on) => {
  const day = (s: Record<string, number>) => JSON.stringify({ [today]: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, onMain: 0, ...s } })
  const files: Record<string, string> = {
    // $0.20 + $0.20 on Sonnet 5.5, $0.40 + $0.40 on Opus 5.5
    'C:/work/demo/.claude/lanes/state/mid.spend.json': day({ calls: 4, unpriced: 4, cacheRead: 2_000_000, output: 20_000 }),
    // one of the two priced: the day can't be split, so it stays as it is
    'C:/work/demo/.claude/lanes/state/low.spend.json': day({ calls: 2, unpriced: 1, cacheRead: 1_000_000, output: 10_000, cost: 0.01, onMain: 0.4 }),
    // the task three of the mid lane's four requests were on, logged at $0 too
    'C:/work/demo/.claude/lanes/state/mid.tasks.json': JSON.stringify({ T2: { lane: 'mid', goal: 'plan the no-show policy', started: 0, calls: 3, cost: 0, onMain: 0, verdict: 'DONE' } }),
  }
  ground(on, files, {}, null)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text
  const tasks = (await $.command.run({ command: 'lane', args: 'tasks' } as never)).text

  expect(ran).toContain('  mid   sonnet-5-5         4 calls     $0.40   on opus-5-5 $0.80  saved $0.40 (50%)')
  expect(ran).toContain('  low   haiku-5-5          2 calls     $0.01   on opus-5-5 $0.40')
  expect(ran).toContain('1 requests were on a model without a known price and count as $0.')
  expect(ran).toContain("4 requests logged at $0 before 0.3.2 (a gateway named the model its own way) are priced from their day's token totals")
  // the task's share by its requests, as an estimate; the rest is lane time outside it
  expect(ran).toContain('  T2    mid  DONE     ≈$0.30 instead of  ≈$0.60  saved ≈$0.30 (50%)  plan the no-show policy')
  expect(ran).toContain('  lane time outside a task (opening, notes): $0.11')
  expect(ran).toContain("  A ≈ task ran before 0.3.2 behind a gateway: its cost is its share of that day's, by its number of requests.")
  expect(ran).not.toContain('has no known price (a typo?)')
  expect(tasks).toContain('≈$0.30 (on main ≈$0.60)  plan the no-show policy')
})

test('a main model in /config with no known price (a typo) is named, and "on main" is worked out on the default', { options: { main_model: 'claude-oups-5-5[1m]' } }, async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files, { CLAUDE_LANE: 'mid' }, { model: 'claude-sonnet-5-5', input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 10_000 })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-sonnet-5-5')
  const ran = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text

  expect(ran).toContain('The main model in /config, claude-oups-5-5[1m], has no known price (a typo?): "on main" is worked out on claude-opus-5-5[1m], the default, instead.')
  expect(ran).toContain('  mid   sonnet-5-5         1 calls     $0.20   on opus-5-5 $0.40  saved $0.20 (50%)')
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

  expect(text).toContain('where it came from, by task (most saved first)\n  T1    mid  PASS      $1.00 instead of   $2.00  saved  $1.00 (50%)  review the uncommitted changes\n  T2    low  DONE      $0.02 instead of   $0.78  saved  $0.76 (97%)  list the session names')
  expect(text).toContain('  lane time outside a task (opening, notes): $0.10')
  expect(text).toContain('per token, sonnet-5-5 costs 1/2 of opus-5-5, haiku-5-5 costs 1/40–1/20 of opus-5-5')
  expect(text).toContain('the lanes took in 312k tokens')
})

// what a compaction leaves: one message
const summary = { role: 'user', text: 'a summary of the conversation so far', toolUses: [] }

// a request whose whole prompt, `k` thousand tokens, is read from the cache
const cached = (model: string, k: number) => ({ model, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: k * 1000, output_tokens: 0 })

test('a lane notes how far its prompt grew over a task: what it read for it', async ($, on) => {
  const files: Record<string, string> = {}
  const prompts = [40, 90, 150]
  let i = 0
  ground(on, files, { CLAUDE_LANE: 'mid' }, () => cached('claude-sonnet-5-5', prompts[i++] ?? 0))
  on('turn.start', ($, e) => e as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: '[T3] survey the logs' } as never)
  for (const _ of prompts) await request($, 'claude-sonnet-5-5')

  const t = JSON.parse(files['C:/work/demo/.claude/lanes/state/mid.tasks.json'] ?? '{}').T3
  expect([t.firstPrompt, t.lastPrompt]).toEqual([40_000, 150_000])
})

test("/lane usage puts a figure on main's lighter context: what a task's reading would have cost main to carry until its context started over", async ($, on) => {
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/mid.spend.json': JSON.stringify({ [today]: { calls: 5, unpriced: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 1, onMain: 2 } }),
    'C:/work/demo/.claude/lanes/state/mid.tasks.json': JSON.stringify({
      T3: { lane: 'mid', goal: 'survey the logs', started: 0, ended: 0, verdict: 'DONE', calls: 5, cost: 1, onMain: 2, firstPrompt: 40_000, lastPrompt: 140_000 },
    }),
  }
  // main's prompt grows 100k → 300k; at 340k the engine compacts it on its own; then 40k and on
  const before = [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300]
  const after = [40, 60, 80]
  const prompts = [...before, ...after]
  let i = 0
  ground(on, files, {}, () => cached('claude-opus-5-5', prompts[i++] ?? 0))
  on('session.receive', ($, e) => ({ text: e.text }) as never)
  on('session.compact', () => ({ messages: [summary], tokensBefore: 340_000, tokensAfter: 40_000 }) as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.session.receive({ origin: { kind: 'peer' }, text: '<agent-message from-name="demo-55c5-mid">\n[T3 DONE] 3 errors, all from one timeout\n</agent-message>' } as never)
  for (const _ of before) await request($, 'claude-opus-5-5')
  // a subagent's own compaction is not main's
  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: [summary] } as never)
  await $.session.compact({ trigger: 'auto', messages: [summary] } as never)
  for (const _ of after) await request($, 'claude-opus-5-5')
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''

  // what the lane read: 100k. With it, main would have compacted once its prompt passed 240k
  // (240k + 100k = 340k, where it did): 7 requests (100k–220k) would have read it again,
  // 7 × 100k × $0.20/M; none after the compaction
  expect(text).toContain(
    [
      "main's context",
      '  the lanes read 100k tokens for a task that main never took in. Had main read it itself, each of its later',
      '  requests would have read it again, until its context, that much fuller, filled and started over: ≈$0.14 on opus-5-5',
      '  (T3 100k × 7 requests)',
    ].join('\n'),
  )
  expect(text).not.toContain('That part is not in the table')
})

test("main's carry record outlives a plugin reload, and a /clear closes it", async ($, on) => {
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/mid.spend.json': JSON.stringify({ [today]: { calls: 5, unpriced: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 1, onMain: 2 } }),
    'C:/work/demo/.claude/lanes/state/mid.tasks.json': JSON.stringify({
      T3: { lane: 'mid', goal: 'survey the logs', started: 0, ended: 0, verdict: 'DONE', calls: 5, cost: 1, onMain: 2, firstPrompt: 40_000, lastPrompt: 140_000 },
    }),
  }
  // main at 300k, 340k, a reload, 450k, a /clear, 30k
  const prompts = [300, 340, 450, 30]
  let i = 0
  ground(on, files, {}, () => cached('claude-opus-5-5', prompts[i++] ?? 0))
  on('session.receive', ($, e) => ({ text: e.text }) as never)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }) as never)
  const start = () => $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await start()
  await $.session.receive({ origin: { kind: 'peer' }, text: '<agent-message from-name="demo-55c5-mid">\n[T3 DONE] done\n</agent-message>' } as never)
  await request($, 'claude-opus-5-5')
  await request($, 'claude-opus-5-5')
  await start()
  await request($, 'claude-opus-5-5')
  await $.session.end({ reason: 'clear', sessionId: 'session-1' } as never)
  await request($, 'claude-opus-5-5')
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''

  // 100k read. Main never compacted, so its context fills, at the latest, where it reached (450k):
  // the requests at 300k and 340k would have carried it, not the one at 450k, nor any after the /clear
  expect(text).toContain('  (T3 100k × 2 requests)')
  expect(JSON.parse(files['C:/work/demo/.claude/lanes/state/main.carry.json'] ?? '{}')['session-1'].later.T3).toEqual({ read: 100, requests: 2 })
})

test('main counts its own lookups, commands and edits, and past 20k tokens read since its last hand-off its next result carries a note', async ($, on) => {
  const files: Record<string, string> = { 'C:/work/demo/.claude/lanes/state/low.json': '{}' }
  ground(on, files, {}, cached('claude-opus-5-5', 50))
  // 25,000 characters of output each: about 8k tokens; grep is read-only, python isn't
  on('tool.call', { tool: 'Bash' }, ($, e) => ({ result: { stdout: '' }, text: 'x'.repeat(25_000), ...((e as { command?: string }).command?.startsWith('grep') ? { isReadOnly: true } : {}) }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited', text: 'ok' }) as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ context?: string[] }>
  const first = await bash('grep -rn TODO src')
  const second = await bash('python check.py')
  const third = await bash('grep -rn FIXME src')
  const fourth = await bash('grep -rn XXX src')
  await $.tool.call({ tool: 'Edit', file_path: 'C:/work/demo/a.py', old_string: 'a', new_string: 'b' } as never)

  expect([first.context, second.context, fourth.context]).toEqual([undefined, undefined, undefined])
  expect(third.context?.[0]).toContain('since your last hand-off you have read about 25k tokens of lookups, pages and command output yourself')
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''
  expect(text).toContain('what main did itself\n  3 lookups and 1 other command, whose output (≈33k tokens) it read and carried; 1 edit; 0 hand-offs to the lanes.')
})

test('the reminder comes at the number of tokens set in /config', { options: { nudge_tokens: 50_000 } }, async ($, on) => {
  const files: Record<string, string> = { 'C:/work/demo/.claude/lanes/state/low.json': '{}' }
  ground(on, files, {}, cached('claude-opus-5-5', 50))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' }, text: 'x'.repeat(50_000), isReadOnly: true }) as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ context?: string[] }>
  const first = await bash('grep -rn a src')
  const second = await bash('grep -rn b src')
  const third = await bash('grep -rn c src')

  expect([first.context, second.context]).toEqual([undefined, undefined])
  expect(third.context?.[0]).toContain('you have read about 50k tokens')
})

test('set to 0 in /config, main is never reminded, and its own work is still counted', { options: { nudge_tokens: 0 } }, async ($, on) => {
  const files: Record<string, string> = { 'C:/work/demo/.claude/lanes/state/low.json': '{}' }
  ground(on, files, {}, cached('claude-opus-5-5', 50))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' }, text: 'x'.repeat(150_000), isReadOnly: true }) as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ context?: string[] }>
  const results = [await bash('grep -rn a src'), await bash('grep -rn b src')]

  expect(results.map(r => r.context)).toEqual([undefined, undefined])
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''
  expect(text).toContain('  2 lookups and 0 other commands, whose output (≈100k tokens) it read and carried')
})

test("main's tool results pass through as they were: an error untouched, a subagent's call uncounted, a hand-off resets the count", async ($, on) => {
  const files: Record<string, string> = { 'C:/work/demo/.claude/lanes/state/low.json': '{}' }
  ground(on, files, {}, cached('claude-opus-5-5', 50))
  const failed = { isError: true, result: 'exit 1', text: 'x'.repeat(25_000) }
  on('tool.call', { tool: 'Bash' }, ($, e) => ((e as { command?: string }).command === 'make' ? failed : { result: { stdout: '' }, text: 'x'.repeat(25_000), isReadOnly: true }) as never)
  on('tool.call', { tool: 'SendMessage' }, () => ({ result: 'sent' }) as never)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await request($, 'claude-opus-5-5')
  const bash = (command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId === undefined ? {} : { agentId }) } as never) as Promise<{ context?: string[] }>

  expect(await bash('make')).toEqual(failed as never)
  await bash('grep -rn a src', 'agent-1')
  await bash('grep -rn b src')
  // a task handed over by message, to the lane's address: a hand-off all the same
  await $.tool.call({ tool: 'SendMessage', to: 'uds:/tmp/lane.sock', message: '[T5] check the build' } as never)
  const after = await bash('grep -rn c src')
  expect(after.context).toBeUndefined()

  await request($, 'claude-opus-5-5')
  const text = (await $.command.run({ command: 'lane', args: 'usage' } as never)).text ?? ''
  expect(text).toContain('  2 lookups and 1 other command, whose output (≈25k tokens) it read and carried; 1 hand-off to the lanes.')
})

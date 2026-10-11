import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Project "demo" on Windows, its files in memory; each model request answers with `usage`.
function ground(on: On, files: Record<string, string>, env: Record<string, string>, usage: Record<string, unknown> | null) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me', ...env })
  mock.clock(on)
  const key = (p: string) => p.replaceAll('\\', '/')
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

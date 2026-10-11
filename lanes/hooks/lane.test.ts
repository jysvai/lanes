import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The low lane of project "demo", writing its state to files.
function ground(on: On, files: Record<string, string>) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me', CLAUDE_LANE: 'low' })
  mock.clock(on)
  const key = (p: string) => p.replaceAll('\\', '/')
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', ($, e) => ({ value: key(e.path) in files }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => (key(e.path) in files ? { value: files[key(e.path)] ?? '' } : { deny: 'no such file' }))
  on('fs.write', ($, e) => {
    files[key(e.path)] = e.text

    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-haiku-5-5' }))
  on('session.id', () => ({ value: 'lane-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', ($, e) => e as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.receive', ($, e) => ({ text: e.text }) as never)
  on('tool.call', { tool: 'SendMessage' }, () => ({ result: 'sent' }) as never)
}

const state = (files: Record<string, string>) => JSON.parse(files['C:/work/demo/.claude/lanes/state/low.json'] ?? '{}')

test('a task that arrives mid-turn waits behind the current one, and the reply moves the lane on to it', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: '[T7] count the files\nout: .claude/lanes/out/T7.md' } as never)
  await $.session.receive({ origin: { kind: 'peer' }, text: '[T8] list the tests\nout: .claude/lanes/out/T8.md' } as never)

  expect(state(files).task.startsWith('[T7]')).toBe(true)
  expect(state(files).next).toEqual(['[T8] list the tests'])

  await $.tool.call({ tool: 'SendMessage', to: 'demo-main', message: '[T7 DONE] 12 files\n→ .claude/lanes/out/T7.md' } as never)

  expect(state(files).task.startsWith('[T8]')).toBe(true)
  expect(state(files).next).toEqual([])
})

test('a claude -p started inside the lane (a summary hook, say) leaves the lane state alone', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: false })
  await $.turn.start({ turnId: 't1', text: 'Summarise this session: ... [T11] audit the boards ...' } as never)

  expect(files['C:/work/demo/.claude/lanes/state/low.json']).toBeUndefined()
})

test('the plugin reloading inside a busy lane keeps its task', async ($, on) => {
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/low.json': JSON.stringify({ tier: 'low', state: 'busy', since: 5, sessionId: 'lane-1', task: '[T10] audit', last: '', turns: 3, tokens: { input: 1, output: 2, cacheRead: 3 } }),
  }
  ground(on, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })

  expect(state(files).state).toBe('busy')
  expect(state(files).task).toBe('[T10] audit')
  expect(state(files).turns).toBe(3)
})

test('a turn raised by a background job finishing keeps the current task', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: '[T6] run the regression' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'step 4 is running in the background', toolUses: [], usage: null } as never)
  await $.turn.start({ turnId: 't2', text: '<task-notification>\n<task-id>b1</task-id>' } as never)

  expect(state(files).task).toBe('[T6] run the regression')
  expect(state(files).state).toBe('busy')
})

test('a progress ping or a sub-task send leaves the current task alone', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: '[T7] count the files' } as never)
  await $.session.receive({ origin: { kind: 'peer' }, text: '[T8] list the tests' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'demo-main', message: '[progress] T7 2/3 done' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'demo-mid', message: '[T7a] grep the logs' } as never)

  expect(state(files).task.startsWith('[T7]')).toBe(true)
  expect(state(files).next).toEqual(['[T8] list the tests'])
})

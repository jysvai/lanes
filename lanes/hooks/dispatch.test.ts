import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A project "demo" whose low lane is running and registered as a peer.
function ground(on: On, sent: { to?: unknown; text?: string }, files: Record<string, string> = {}) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me' })
  const clock = mock.clock(on)
  files['C:/Users/me/.claude/sessions/11.json'] = JSON.stringify({ pid: 11, name: 'demo-low', sessionId: 'lane-1' })
  files['C:/Users/me/.claude/sessions/22.json'] = JSON.stringify({ pid: 22, name: 'demo-main', sessionId: 'main-1' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  // the engine hands hooks native paths (backslashes on Windows)
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.list', ($, e) => ({
    value: key(e.path).endsWith('/sessions')
      ? [{ name: '11.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: '22.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : [],
  }))
  on('fs.read', ($, e) => (key(e.path) in files ? { value: files[key(e.path)] ?? '' } : { deny: 'no such file' }))
  on('fs.write', ($, e) => {
    files[key(e.path)] = e.text

    return { value: undefined }
  })
  on('session.id', () => ({ value: 'main-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'lane' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__lanes__send' } }))
  on('session.send', ($, e) => {
    sent.to = e.to
    sent.text = e.text

    return { isDelivered: true }
  })

  return clock
}

test('/lane low <task> numbers the task and hands it to the running low lane', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low list every file under src' } as never)

  expect(ran.text).toBe('T1 → demo-low')
  expect(sent.to).toBe('demo-low')
  expect(sent.text).toBe('[T1] list every file under src\nout: .claude/lanes/out/T1.md\nreply to: demo-main')
})

test('/lane <request> hands the request to the main model to run across the lanes', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  const submitted: string[] = []
  const clock = ground(on, sent)
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'stop the login page from flickering' } as never)
  await clock.advance(100)

  expect(ran.text).toBe('Handed to the main session to run across the lanes.')
  expect(submitted.length).toBe(1)
  expect(submitted[0]?.startsWith('Lane request: stop the login page from flickering\n')).toBe(true)
  expect(submitted[0]).toContain('demo-low')
  expect(submitted[0]).toContain('demo-mid')
  expect(sent.to).toBeUndefined()
})

test('a task for a busy lane waits in its queue and goes over once the lane is idle', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  const files: Record<string, string> = {}
  const clock = ground(on, sent, files)
  files['C:/work/demo/.claude/lanes/state/low.json'] = JSON.stringify({ tier: 'low', state: 'busy', since: 0, task: '[T9] earlier work' })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low count the files' } as never)

  expect(ran.text).toBe('T1 queued for demo-low (1 waiting); it goes over when T9 is done.')
  expect(sent.to).toBeUndefined()

  files['C:/work/demo/.claude/lanes/state/low.json'] = JSON.stringify({ tier: 'low', state: 'idle', since: 0, task: '[T9] earlier work' })
  await clock.advance(15_000)

  expect(sent.to).toBe('demo-low')
  expect(sent.text?.startsWith('[T1] count the files')).toBe(true)
  expect(files['C:/work/demo/.claude/lanes/state/low.queue.json']).toBe('[]')
})

test('the next task gets the next number', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'low first' } as never)
  const ran = await $.command.run({ command: 'lane', args: 'low second' } as never)

  expect(ran.text).toBe('T2 → demo-low')
})

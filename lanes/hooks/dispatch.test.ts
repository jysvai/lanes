import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A project "demo" whose low lane is running and registered as a peer.
function ground(on: On, sent: { to?: unknown; text?: string }) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me' })
  mock.clock(on)
  const files: Record<string, string> = {
    'C:/Users/me/.claude/sessions/11.json': JSON.stringify({ pid: 11, name: 'demo-low', sessionId: 'lane-1' }),
    'C:/Users/me/.claude/sessions/22.json': JSON.stringify({ pid: 22, name: 'demo-main', sessionId: 'main-1' }),
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  // the engine hands hooks native paths (backslashes on Windows)
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.list', ($, e) => ({
    value: key(e.path).endsWith('/sessions')
      ? [{ name: '11.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: '22.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : [],
  }))
  on('fs.read', ($, e) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'no such file' }))
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
}

test('/lane low <task> numbers the task and hands it to the running low lane', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low list every file under src' })

  expect(ran.text).toBe('T1 → demo-low')
  expect(sent.to).toBe('demo-low')
  expect(sent.text).toBe('[T1] list every file under src\nout: .claude/lanes/out/T1.md\nreply to: demo-main')
})

test('the next task gets the next number', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'low first' })
  const ran = await $.command.run({ command: 'lane', args: 'low second' })

  expect(ran.text).toBe('T2 → demo-low')
})

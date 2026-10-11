import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A project "demo" whose low lane is running and registered as a peer.
function ground(on: On, sent: { to?: unknown; text?: string; run?: string }, files: Record<string, string> = {}, delivered = true, env: Record<string, string> = { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me' }) {
  mock.env(on, env)
  const clock = mock.clock(on)
  files['C:/Users/me/.claude/sessions/11.json'] = JSON.stringify({ pid: 11, name: 'demo-55c5-low', sessionId: 'lane-1' })
  files['C:/Users/me/.claude/sessions/22.json'] = JSON.stringify({ pid: 22, name: 'demo-main', sessionId: 'main-1' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  // the engine hands hooks native paths: backslashes on Windows, and on macOS a C:/ path,
  // which isn't absolute there, comes resolved against the plugin's folder
  const key = (path: string) => path.replaceAll('\\', '/').replace(/^.*\/(?=[A-Za-z]:\/)/, '')
  on('fs.list', ($, e) => ({
    value: key(e.path).endsWith('/sessions')
      ? [{ name: '11.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: '22.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : key(e.path).endsWith('/lanes/out')
        ? ['T3.md', 'T3-phone.png', 'T4-src-c01.json', 'T4.md', 'T4-err.log'].map((name, i) => ({ name, kind: 'file' as const, size: 1, mtimeMs: i, isLink: false }))
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

    return delivered ? { isDelivered: true } : { isDelivered: false, reason: 'no agent named demo-55c5-low is reachable' }
  })
  on('prompt.compose', () => ({ sections: [] }))
  on('session.receive', ($, e) => ({ text: e.text }) as never)
  on('process.run', ($, e) => {
    sent.run = JSON.stringify(e)

    return { value: { stdout: 'demo-55c5-low starting', stderr: '', exitCode: 0 } } as never
  })

  return clock
}

test('/lane low <task> numbers the task and hands it to the running low lane', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low list every file under src' } as never)

  expect(ran.text).toBe('T1 → demo-55c5-low')
  expect(sent.to).toBe('demo-55c5-low')
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
  expect(submitted[0]).toContain('demo-55c5-low')
  expect(submitted[0]).toContain('demo-55c5-mid')
  expect(sent.to).toBeUndefined()
})

test('a task for a busy lane waits in its queue and goes over once the lane is idle', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  const files: Record<string, string> = {}
  const clock = ground(on, sent, files)
  files['C:/work/demo/.claude/lanes/state/low.json'] = JSON.stringify({ tier: 'low', state: 'busy', since: 0, task: '[T9] earlier work' })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low count the files' } as never)

  expect(ran.text).toBe('T1 queued for demo-55c5-low (1 waiting); it goes over when T9 is done.')
  expect(sent.to).toBeUndefined()

  files['C:/work/demo/.claude/lanes/state/low.json'] = JSON.stringify({ tier: 'low', state: 'idle', since: 0, task: '[T9] earlier work' })
  await clock.advance(15_000)

  expect(sent.to).toBe('demo-55c5-low')
  expect(sent.text?.startsWith('[T1] count the files')).toBe(true)
  expect(files['C:/work/demo/.claude/lanes/state/low.queue.json']).toBe('[]')
})

test('a lane killed without clearing its registry entry gets a fresh lane, and the task is not lost', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  const files: Record<string, string> = {}
  ground(on, sent, files, false)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'low count the files' } as never)

  expect(ran.text).toBe('T1 queued for demo-55c5-low; demo-55c5-low starting. The lane picks it up when it opens.')
  expect(JSON.parse(files['C:/work/demo/.claude/lanes/state/low.queue.json'] ?? '[]')[0].startsWith('[T1] count the files')).toBe(true)
})

test('a subcommand with a wrong argument, or a slip of one, shows the usage instead of becoming a request', async ($, on) => {
  const sent: { to?: unknown; text?: string; run?: string } = {}
  const submitted: string[] = []
  const clock = ground(on, sent)
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const lane = async (args: string) => (await $.command.run({ command: 'lane', args } as never)).text ?? ''

  expect(await lane('usage weekly')).toStartWith('/lane usage [all|today]\nusage:')
  expect(await lane('stop lwo')).toStartWith('/lane stop [mid|low|all]')
  expect(await lane('mid')).toStartWith('/lane mid <task>')
  expect(await lane('statsu')).toStartWith('/lane status? "statsu" isn\'t a subcommand.')
  expect(await lane('help')).toStartWith('usage: /lane <request>')
  await clock.advance(100)
  expect(submitted).toEqual([])
  expect(sent.run).toBeUndefined()
})

test('subcommands work in any case and in Korean', async ($, on) => {
  const sent: { to?: unknown; text?: string; run?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const lane = async (args: string) => (await $.command.run({ command: 'lane', args } as never)).text ?? ''

  expect(await lane('Status')).toContain('demo-55c5-mid: ')
  expect(await lane('상태')).toContain('demo-55c5-mid: ')
  expect(await lane('작업')).toBe('No lane tasks yet.')
  expect(await lane('비용 전체')).toStartWith('No spend yet.')
  await lane('중지 low')
  expect(sent.run).toContain("'stop' 'low'")
  await lane('START mid low')
  expect(sent.run).toContain("'start' 'all'")
  expect(await lane('LOW count the Files')).toBe('T1 → demo-55c5-low')
  expect(sent.text?.startsWith('[T1] count the Files')).toBe(true)
})

test('the next task gets the next number', async ($, on) => {
  const sent: { to?: unknown; text?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'low first' } as never)
  const ran = await $.command.run({ command: 'lane', args: 'low second' } as never)

  expect(ran.text).toBe('T2 → demo-55c5-low')
})

test('/lane status names the task reports, not the screenshots and scratch files next to them', async ($, on) => {
  ground(on, {})
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'status' } as never)

  expect(ran.text).toContain('recent reports (.claude/lanes/out): T4.md, T3.md\n')
})

test('two projects with the same folder name, or a folder name with no ASCII letters, get lanes of their own', async ($, on) => {
  ground(on, {})
  await $.session.start({ cwd: 'C:/other/demo', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'lane', args: 'status' } as never)).text).toContain('demo-b08a-mid: ')

  await $.session.start({ cwd: 'C:\\work\\손글씨', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'lane', args: 'status' } as never)).text).toContain('project-712c-mid: ')
})

test("a project path with a curly apostrophe (Jack’s App) is quoted for PowerShell", async ($, on) => {
  const sent: { to?: unknown; text?: string; run?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/Users/Bob/Jack’s App', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'start low' } as never)

  expect(sent.run).toContain("-Project 'C:/Users/Bob/Jack’’s App'")
})

test('opening a lane hands the script its name and the permission mode from /config', { options: { permission_mode: 'dontAsk' } }, async ($, on) => {
  const sent: { to?: unknown; text?: string; run?: string } = {}
  ground(on, sent)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'start mid' } as never)

  // the script's text runs as a script block, which a managed PC's execution policy doesn't refuse
  expect(sent.run).toContain('[scriptblock]::Create([IO.File]::ReadAllText(')
  expect(sent.run).not.toContain('-File')
  expect(sent.run).toContain("'start' 'mid'")
  expect(sent.run).toContain("-Name 'demo-55c5'")
  expect(sent.run).toContain("-PermissionMode 'dontAsk'")
})

test('on macOS and Linux a lane opens through bash, with its settings in the environment', async ($, on) => {
  const sent: { to?: unknown; text?: string; run?: string } = {}
  ground(on, sent, {}, true, { HOME: '/Users/me' })
  await $.session.start({ cwd: '/Users/bob/Jack’s App', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'start mid' } as never)

  expect(sent.run).toContain('"/bin/bash"')
  expect(sent.run).toContain('/bin/lanes.sh","start","mid"')
  expect(sent.run).not.toContain('powershell')
  expect(sent.run).toContain('"LANES_PROJECT":"/Users/bob/Jack’s App"')
  expect(sent.run).toMatch(/"LANES_SLUG":"jack-s-app-[0-9a-f]{4}"/)
  expect(sent.run).toContain('"LANES_PERMISSION_MODE":"auto"')
})

test("a lane that hasn't come up a while after opening shows a warning, not just off", async ($, on) => {
  const files: Record<string, string> = {}
  const clock = ground(on, {}, files)
  // the low lane is not running
  delete files['C:/Users/me/.claude/sessions/11.json']
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lane', args: 'low count the files' } as never)
  await clock.advance(20_000)

  expect((await $.command.run({ command: 'lane', args: 'status' } as never)).text).toContain('demo-55c5-low: haiku off')

  await clock.advance(40_000)
  const status = (await $.command.run({ command: 'lane', args: 'status' } as never)).text

  expect(status).toContain('demo-55c5-low: haiku ⚠ not up 1m')
  expect(status).toContain('is likely waiting on a prompt (folder trust, a permission)')

  // once it registers, the warning goes
  files['C:/Users/me/.claude/sessions/11.json'] = JSON.stringify({ pid: 11, name: 'demo-55c5-low', sessionId: 'lane-1' })
  expect((await $.command.run({ command: 'lane', args: 'status' } as never)).text).toContain('demo-55c5-low: haiku ○')
})

const entry = (lane: string, goal: string, started: number, more: Record<string, unknown> = {}) =>
  ({ lane, goal, started, calls: 1, cost: 0.01, onMain: 0.2, ...more })
const facts = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] }
const policyOf = async ($: { prompt: { compose: (f: typeof facts) => Promise<{ sections: readonly { id: string; text: string }[] }> } }) =>
  (await $.prompt.compose(facts)).sections.find(s => s.id === 'lanes:policy')?.text ?? ''

test('a reply that came while no main session was open is handed to the next one, once', async ($, on) => {
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/low.tasks.json': JSON.stringify({
      T7: entry('low', 'count the files', 0, { ended: 60_000, verdict: 'DONE', reply: '[T7 DONE] 12 files', to: 'demo-main' }),
      // a sub-task's reply went to the mid lane, not to main
      T6a: entry('low', 'grep the logs', 0, { ended: 30_000, verdict: 'DONE', reply: '[T6a DONE] 3 hits', to: 'demo-55c5-mid' }),
    }),
  }
  const clock = ground(on, {}, files)
  await clock.advance(120_000)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const policy = await policyOf($ as never)

  expect(policy).toContain('- [T7 DONE] 12 files (low, 1m ago) → .claude/lanes/out/T7.md')
  expect(policy).not.toContain('T6a')
  expect(Object.keys(JSON.parse(files['C:/work/demo/.claude/lanes/state/main.seen.json'] ?? '{}'))).toEqual(['T7'])

  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  expect(await policyOf($ as never)).not.toContain('T7 DONE')
})

test('a reply the main session receives is marked seen', async ($, on) => {
  const files: Record<string, string> = {}
  ground(on, {}, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  await $.session.receive({ origin: { kind: 'peer' }, text: '<agent-message from-name="demo-55c5-low">\n[T9 DONE] 4 files\n→ .claude/lanes/out/T9.md\n</agent-message>' } as never)

  expect(Object.keys(JSON.parse(files['C:/work/demo/.claude/lanes/state/main.seen.json'] ?? '{}'))).toEqual(['T9'])
})

test("the main session's prompt carries the lanes' project map", async ($, on) => {
  const files: Record<string, string> = { 'C:/work/demo/.claude/lanes/notes/index.md': '- auth: src/auth/*.ts → notes/auth.md' }
  ground(on, {}, files)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })

  expect(await policyOf($ as never)).toContain("## The lanes' project map")
  expect(await policyOf($ as never)).toContain('- auth: src/auth/*.ts → notes/auth.md')
})

test('/lane tasks lists both lanes\' tasks newest first, with what each cost', async ($, on) => {
  const files: Record<string, string> = {
    'C:/work/demo/.claude/lanes/state/low.tasks.json': JSON.stringify({ T1: entry('low', 'count the files', 0, { ended: 60_000, verdict: 'DONE' }) }),
    'C:/work/demo/.claude/lanes/state/mid.tasks.json': JSON.stringify({ T2: entry('mid', 'run the tests', 120_000) }),
  }
  const clock = ground(on, {}, files)
  await clock.advance(300_000)
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'lane', args: 'tasks' } as never)

  expect(ran.text).toContain('  T2    mid  open       3m    $0.01 (on main $0.20)  run the tests\n  T1    low  DONE       1m')
  expect(ran.text).toContain('all 2 tasks: $0.02, on opus-5-5 $0.40.')
})

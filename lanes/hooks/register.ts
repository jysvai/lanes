import type { EngineInterface, Register, Timer } from 'claude-code'

// Lanes: helper Claude Code sessions beside the main one, opened only when there
// is work for them. The mid lane (Sonnet by default) tests and verifies; the low
// lane (Haiku by default) searches, runs scripts, crawls and sorts notes. Only the
// main session edits code.
//
// One module serves both sides. A lane is a session started with CLAUDE_LANE set
// (bin/lanes.ps1, bin/lanes.sh); it writes its state to .claude/lanes/state/ and
// closes itself when idle. The main session reads that state into its status line,
// hands work over with /lane or the send tool, and keeps lane progress pings off
// the model's turn.

type Tier = 'mid' | 'low'
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type TierConfig = { model: string; fallback: string; effort: Effort }

type Config = {
  main: TierConfig
  mid: TierConfig
  low: TierConfig
  launch: 'window' | 'background'
  idleMinutes: number
}

type LaneState = {
  tier: Tier
  state: 'idle' | 'busy' | 'off'
  since: number
  model: string
  sessionId: string
  task: string
  /** tasks that arrived while the lane was on `task`, oldest first */
  next?: string[]
  /** `task` still owes its sender a "[Tn PASS|DONE|...]" reply */
  open?: boolean
  last: string
  turns: number
  tokens: { input: number; output: number; cacheRead: number }
}

type Peer = { pid: number; name: string; status?: string; sessionId?: string }

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens?: number }

type Role = Tier | 'main'
type Spend = { calls: number; unpriced: number; input: number; cacheWrite: number; cacheRead: number; output: number; cost: number; onMain: number }
/** one role's spend in this project per local day ("2026-10-11"), in dollars at API list prices */
type SpendLog = Record<string, Spend>
type Rate = readonly [input: number, cacheWrite: number, cacheRead: number, output: number]

const TIERS: Tier[] = ['mid', 'low']
const ROLES: Role[] = ['main', ...TIERS]

// $ per million tokens at API list prices (platform.claude.com/docs/en/about-claude/pricing): input,
// 1-hour cache write (the cache Claude Code writes), cache read, output. First match wins, so a
// version comes before the family it starts with. Haiku 5.5 costs more on a prompt over 100k tokens.
const PRICES: [RegExp, Rate, Rate?][] = [
  [/fable-5-1|mythos-5-1/, [10, 20, 0.25, 50]],
  [/fable-5|mythos-5/, [10, 20, 1, 50]],
  [/opus-5-5/, [4, 8, 0.2, 20]],
  [/opus-5|opus-4-8/, [5, 10, 0.5, 25]],
  [/sonnet-5-5/, [2, 4, 0.1, 10]],
  [/sonnet-5/, [2, 4, 0.2, 10]],
  [/haiku-5-5/, [0.1, 0.2, 0.01, 0.5], [0.5, 1, 0.05, 2.5]],
  [/haiku-4-5/, [1, 2, 0.1, 5]],
]
const RANK: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PROGRESS_MS = 15 * 60_000
const POLL_MS = 5000
const USAGE = 'usage: /lane <request> · /lane status · /lane usage [all] · /lane start|stop [mid|low|all] · /lane mid <task> · /lane low <task>'

// The module's own variables start over on a reload; session.start fills them again.
let cfg: Config = {
  main: { model: 'claude-opus-5-5[1m]', fallback: 'claude-fable-5-1', effort: 'xhigh' },
  mid: { model: 'claude-sonnet-5-5', fallback: 'claude-opus-5-5', effort: 'high' },
  low: { model: 'claude-haiku-5-5', fallback: '', effort: 'medium' },
  launch: 'window',
  idleMinutes: 20,
}
let project = ''
let dir = ''
let slug = 'project'
let home = ''
let pluginRoot = ''
let isWindows = true
let tier: Tier | undefined
let isMain = false
let me: LaneState | undefined
let pending = ''
let progress = { text: '', at: 0 }
let mainName = ''
let idleTimer: Timer | undefined
let spend: SpendLog = {}

const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v.trim() : fallback)
const effortOf = (v: unknown, fallback: Effort): Effort => (RANK.includes(v as Effort) ? (v as Effort) : fallback)

function configure(options: Readonly<Record<string, unknown>>) {
  cfg = {
    main: {
      model: text(options.main_model, cfg.main.model),
      fallback: text(options.main_fallback, cfg.main.fallback),
      effort: effortOf(options.main_effort, cfg.main.effort),
    },
    mid: {
      model: text(options.mid_model, cfg.mid.model),
      fallback: text(options.mid_fallback, cfg.mid.fallback),
      effort: effortOf(options.mid_effort, cfg.mid.effort),
    },
    low: {
      model: text(options.low_model, cfg.low.model),
      fallback: text(options.low_fallback, cfg.low.fallback),
      effort: effortOf(options.low_effort, cfg.low.effort),
    },
    launch: options.launch === 'background' ? 'background' : 'window',
    idleMinutes: typeof options.idle_minutes === 'number' ? Math.max(0, options.idle_minutes) : cfg.idleMinutes,
  }
}

const laneName = (t: Tier) => `${slug}-${t}`

const firstLine = (s: string) => (s.split('\n').map(line => line.trim()).find(Boolean) ?? '').slice(0, 90)

// "[T7] goal" or "[U3] goal" anywhere in a message names the task
const taskLine = (s: string) => (s.match(/\[[A-Z]\d+[a-z]?\][^\n<]*/)?.[0] ?? firstLine(s)).slice(0, 90)
const isTask = (s: string) => /\[[A-Z]\d+[a-z]?\]/.test(s)

const ago = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)

const stateFile = (t: Tier) => `${dir}/state/${t}.json`
const queueFile = (t: Tier) => `${dir}/state/${t}.queue.json`
const spendFile = (r: Role) => `${dir}/state/${r}.spend.json`

const pad2 = (n: number) => String(n).padStart(2, '0')
const dayOf = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// What one request cost on a model, or undefined for a model without a known price.
function price(model: string, u: Usage): number | undefined {
  const hit = PRICES.find(([re]) => re.test(model))
  if (hit === undefined) return undefined
  const write = u.cache_creation_input_tokens ?? 0
  const prompt = u.input_tokens + write + u.cache_read_input_tokens
  const [input, cacheWrite, cacheRead, output] = (prompt > 100_000 ? hit[2] : undefined) ?? hit[1]

  return (u.input_tokens * input + write * cacheWrite + u.cache_read_input_tokens * cacheRead + u.output_tokens * output) / 1e6
}

const noSpend = (): Spend => ({ calls: 0, unpriced: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, onMain: 0 })

function addSpend(a: Spend, b: Spend): Spend {
  return {
    calls: a.calls + b.calls,
    unpriced: a.unpriced + b.unpriced,
    input: a.input + b.input,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    cost: a.cost + b.cost,
    onMain: a.onMain + b.onMain,
  }
}

async function readSpend($: EngineInterface, r: Role): Promise<SpendLog> {
  try {
    return JSON.parse(String(await $.fs.read(spendFile(r)))) as SpendLog
  } catch {
    return {}
  }
}

// Every model request of this session (subagents included) adds to its role's log for the day,
// with what the same tokens would have cost on the main model.
async function record($: EngineInterface, usage: (Usage & { model: string }) | null | undefined) {
  const role: Role | undefined = tier ?? (isMain ? 'main' : undefined)
  if (role === undefined || !usage) return
  if (me !== undefined) {
    me.tokens.input += usage.input_tokens
    me.tokens.output += usage.output_tokens
    me.tokens.cacheRead += usage.cache_read_input_tokens
  }
  // a main session keeps a log only in a project that has used the lanes
  if (role === 'main' && !(await $.fs.exists(`${dir}/state`))) return
  const day = dayOf(await $.clock.now())
  const cost = price(usage.model, usage)
  const s = (spend[day] ??= noSpend())
  s.calls += 1
  s.unpriced += cost === undefined ? 1 : 0
  s.input += usage.input_tokens
  s.cacheWrite += usage.cache_creation_input_tokens ?? 0
  s.cacheRead += usage.cache_read_input_tokens
  s.output += usage.output_tokens
  s.cost += cost ?? 0
  s.onMain += price(cfg.main.model, usage) ?? cost ?? 0
  await $.fs.write(spendFile(role), JSON.stringify(spend, null, 1))
}

async function spendReport($: EngineInterface, all: boolean) {
  const today = dayOf(await $.clock.now())
  const logs = await Promise.all(ROLES.map(async r => [r, await readSpend($, r)] as const))
  const days = [...new Set(logs.flatMap(([, log]) => Object.keys(log)))].sort()
  const of = (log: SpendLog) => (all ? Object.values(log) : [log[today] ?? noSpend()]).reduce(addSpend, noSpend())
  const by = new Map(logs.map(([r, log]) => [r, of(log)]))
  const lanes = TIERS.map(t => by.get(t) ?? noSpend()).reduce(addSpend, noSpend())
  const main = by.get('main') ?? noSpend()
  const total = addSpend(main, lanes)
  if (total.calls === 0) return 'No spend logged yet. Every model request of the main and lane sessions in this project is logged from now on.'
  const $$ = (n: number) => `$${n.toFixed(2)}`
  const short = (r: Role) => cfg[r].model.replace(/^claude-|\[1m\]$/g, '')
  const saved = (s: Spend) => (s.onMain > s.cost ? `  saved ${$$(s.onMain - s.cost)} (${Math.round((1 - s.cost / s.onMain) * 100)}%)` : '')
  const row = (name: string, model: string, s: Spend, vs: boolean) =>
    `  ${name.padEnd(6)}${model.padEnd(14)}${String(s.calls).padStart(6)} calls ${$$(s.cost).padStart(9)}${vs ? `   on ${short('main')} ${$$(s.onMain)}${saved(s)}` : ''}`
  const unpriced = total.unpriced > 0 ? `\n${total.unpriced} requests were on a model without a known price and count as $0.` : ''

  return [
    `lane spend ${all ? `${days[0]} to ${days[days.length - 1]}` : `today (${today})`}, at API list prices`,
    row('main', short('main'), main, false),
    ...TIERS.map(t => row(t, short(t), by.get(t) ?? noSpend(), true)),
    row('lanes', '', lanes, true),
    row('all', '', total, true),
    `Every model request of the main and lane sessions here, subagents included, priced per request with 1-hour cache writes`,
    `(platform.claude.com/docs/en/about-claude/pricing). A plan isn't billed per token, but its usage limits weigh the models much the same way.${unpriced}`,
  ].join('\n')
}

// The effort a main-loop request should carry, or undefined to leave it: lanes run
// at their fixed effort, an Opus or Fable main session never below its floor.
function stepEffort(model: string, effort: unknown, agentId: string | undefined): Effort | undefined {
  if (agentId !== undefined || typeof effort !== 'string') return undefined
  if (tier !== undefined) return effort === cfg[tier].effort ? undefined : cfg[tier].effort
  if (!/opus|fable/.test(model)) return undefined
  if (RANK.indexOf(effort as Effort) >= RANK.indexOf(cfg.main.effort)) return undefined

  return cfg.main.effort
}

// What "/lane <request>" hands the main model: the request, and how to run it
// across the lanes until it is done and verified.
function orchestration(request: string) {
  return [
    `Lane request: ${request}`,
    '',
    'Run this request with the lanes, start to finish, without stopping to ask unless a decision is truly mine:',
    `1. Split it into steps. Searching, listing, running scripts and counting, crawling: ${laneName('low')}. Tests, verifying your changes, reviews, fact checks: ${laneName('mid')}. Code and content edits, commits, deploys: you.`,
    '2. Send independent lane work first with mcp__lanes__send so it runs while you edit. Give each task its goal, the files or commands, and what counts as done.',
    '3. When a lane answers, act on it: fix what failed, then send the fix to the mid lane to verify. Open .claude/lanes/out/<id>.md only when the short answer is not enough.',
    '4. Finish when the request is done and verified. Tell me what changed, what the lanes checked, and what is still open.',
  ].join('\n')
}

async function submitRequest($: EngineInterface, request: string) {
  await $.prompt.submit({ text: orchestration(request), asUser: true })
}

function policy() {
  const idle = cfg.idleMinutes > 0 ? ` and close themselves after ${cfg.idleMinutes} idle minutes` : ''

  return [
    '# Lanes (helper sessions)',
    `Two helper Claude Code sessions can work beside you on this project. They open only when you send them work${idle}.`,
    `- ${laneName('mid')} (${cfg.mid.model}, effort ${cfg.mid.effort}): tests, verifying your changes, reviews, research checks, playtests.`,
    `- ${laneName('low')} (${cfg.low.model}, effort ${cfg.low.effort}): searching and listing, running scripts and counting results, crawling sites, sorting notes.`,
    'Only you edit code and content, commit, push and deploy. Hand a lane work that would otherwise fill your context: mcp__lanes__send({ lane, task }) gives it a task id and a report file and opens the lane if it is closed. The lane answers in a few lines as a message; read its full report in .claude/lanes/out/<id>.md only when the answer is not enough. Shared notes live in .claude/lanes/notes/. mcp__lanes__status shows what each lane is doing; never message a lane just to ask.',
  ].join('\n')
}

async function peers($: EngineInterface): Promise<Map<string, Peer>> {
  const found = new Map<string, Peer>()
  let entries: { name: string }[] = []
  try {
    entries = await $.fs.list(`${home}/sessions`)
  } catch {
    return found
  }
  await Promise.all(
    entries
      .filter(f => f.name.endsWith('.json'))
      .map(async f => {
        try {
          const p = JSON.parse(String(await $.fs.read(`${home}/sessions/${f.name}`))) as Peer
          if (typeof p.name === 'string') found.set(p.name, p)
        } catch {
          // a session mid-write or gone
        }
      }),
  )

  return found
}

async function readLane($: EngineInterface, t: Tier): Promise<LaneState | undefined> {
  try {
    return JSON.parse(String(await $.fs.read(stateFile(t)))) as LaneState
  } catch {
    return undefined
  }
}

async function save($: EngineInterface) {
  if (tier !== undefined && me !== undefined) await $.fs.write(stateFile(tier), JSON.stringify(me, null, 1))
}

// "sonnet" for claude-sonnet-5-5: the short name the status line shows a lane by
const shortName = (t: Tier) => cfg[t].model.match(/opus|sonnet|haiku|fable/)?.[0] ?? t

// "T7" out of "[T7] goal"
const taskId = (task: string) => task.match(/\[([A-Z]\d+[a-z]?)\]/)?.[1] ?? '…'

// One short cell per lane: "sonnet ● T7 3m +1", "haiku ○", "haiku off"
function describe(t: Tier, peer: Peer | undefined, s: LaneState | undefined, now: number, waiting = 0) {
  const more = waiting > 0 ? ` +${waiting}` : ''
  if (peer === undefined) return `${shortName(t)} off${more}`
  if (s === undefined || s.state !== 'busy') return `${shortName(t)} ○${more}`

  const after = waiting + (s.next?.length ?? 0)

  return `${shortName(t)} ● ${taskId(s.task)} ${ago(now - s.since)}${after > 0 ? ` +${after}` : ''}`
}

async function statusLine($: EngineInterface) {
  if (!(await $.fs.exists(`${dir}/state`))) return undefined
  const now = await $.clock.now()
  const live = await peers($)
  const parts = await Promise.all(
    TIERS.map(async t => describe(t, live.get(laneName(t)), await readLane($, t), now, (await readQueue($, t)).length)),
  )

  return `lanes  ${parts.join(' · ')}`
}

async function refresh($: EngineInterface) {
  $.ui.status(await statusLine($))
}

async function report($: EngineInterface) {
  const now = await $.clock.now()
  const live = await peers($)
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const rows = await Promise.all(
    TIERS.map(async t => {
      const s = await readLane($, t)
      const head = `${laneName(t)}: ${describe(t, live.get(laneName(t)), s, now)} · ${cfg[t].model}, effort ${cfg[t].effort}`
      if (s === undefined) return head
      const ping = progress.text.startsWith(laneName(t)) && now - progress.at < PROGRESS_MS ? `\n  progress: ${progress.text}` : ''

      return [
        head + ping,
        `  task: ${s.task || '-'}`,
        ...(s.state === 'busy' && s.next?.length ? [`  next: ${s.next.map(taskId).join(', ')}`] : []),
        `  last: ${s.last || '-'}`,
        `  ${s.turns} turns · in ${k(s.tokens.input)} · cache ${k(s.tokens.cacheRead)} · out ${k(s.tokens.output)}`,
      ].join('\n')
    }),
  )
  let recent = ''
  try {
    // the task reports only; screenshots and scratch files a lane leaves next to them would crowd them out
    const files = (await $.fs.list(`${dir}/out`)).filter(f => f.kind === 'file' && /^[A-Z]\d+[a-z]?\.md$/.test(f.name))
    const newest = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5)
    if (newest.length > 0) recent = `\nrecent reports (.claude/lanes/out): ${newest.map(f => f.name).join(', ')}`
  } catch {
    // no reports yet
  }

  const today = dayOf(now)
  const lanes = (await Promise.all(TIERS.map(async t => (await readSpend($, t))[today] ?? noSpend()))).reduce(addSpend, noSpend())
  const spent = lanes.calls > 0
    ? `\nlanes today: $${lanes.cost.toFixed(2)}, on ${cfg.main.model.replace(/^claude-|\[1m\]$/g, '')} it would have been $${lanes.onMain.toFixed(2)} (/lane usage)`
    : ''

  return `${rows.join('\n')}${recent}${spent}\nT<n> is task number n in this project; its full report is .claude/lanes/out/T<n>.md`
}

async function runScript($: EngineInterface, verb: 'start' | 'stop', which: Tier | 'all') {
  const none = (s: string) => s || 'none'
  const ran = isWindows
    ? await $.process.run(
        [
          'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${pluginRoot}/bin/lanes.ps1`,
          verb, which, '-Project', project, '-Launch', cfg.launch,
          '-MidModel', cfg.mid.model, '-MidFallback', none(cfg.mid.fallback), '-MidEffort', cfg.mid.effort,
          '-LowModel', cfg.low.model, '-LowFallback', none(cfg.low.fallback), '-LowEffort', cfg.low.effort,
        ],
        { timeoutMs: 120_000 },
      )
    : await $.process.run(['/bin/bash', `${pluginRoot}/bin/lanes.sh`, verb, which], {
        timeoutMs: 120_000,
        env: {
          LANES_PROJECT: project,
          LANES_LAUNCH: cfg.launch,
          LANES_MID_MODEL: cfg.mid.model,
          LANES_MID_FALLBACK: none(cfg.mid.fallback),
          LANES_MID_EFFORT: cfg.mid.effort,
          LANES_LOW_MODEL: cfg.low.model,
          LANES_LOW_FALLBACK: none(cfg.low.fallback),
          LANES_LOW_EFFORT: cfg.low.effort,
        },
      })
  await refresh($)

  return `${ran.stdout}${ran.stderr}`.trim() || `${verb}: exit ${ran.exitCode}`
}

async function whoAmI($: EngineInterface) {
  if (mainName !== '') return mainName
  const id = await $.session.id()
  for (const p of (await peers($)).values()) {
    if (p.sessionId === id) mainName = p.name
  }

  return mainName
}

async function nextTaskId($: EngineInterface) {
  const file = `${dir}/state/seq`
  let n = 0
  try {
    n = Number.parseInt(String(await $.fs.read(file)), 10) || 0
  } catch {
    // first task in this project
  }
  await $.fs.write(file, String(n + 1))

  return `T${n + 1}`
}

async function readQueue($: EngineInterface, t: Tier): Promise<string[]> {
  try {
    const list = JSON.parse(String(await $.fs.read(queueFile(t))))

    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

// Hands a task to a lane. An idle lane gets it now; a busy lane gets it from the
// queue once it is idle again (pump), and a closed lane is opened and takes the
// queue when it starts.
async function dispatch($: EngineInterface, t: Tier, task: string) {
  const id = await nextTaskId($)
  const from = await whoAmI($)
  const body = `[${id}] ${task}\nout: .claude/lanes/out/${id}.md${from ? `\nreply to: ${from}` : ''}`
  const name = laneName(t)
  const isLive = (await peers($)).has(name)
  const state = await readLane($, t)
  const queued = await readQueue($, t)
  if (isLive && state?.state !== 'busy' && queued.length === 0) {
    const sent = await $.session.send({ to: name, text: body })
    if (sent.isDelivered) return `${id} → ${name}`
    // A registry entry left behind by a lane that was killed: open a fresh lane for the task.
    await $.fs.write(queueFile(t), JSON.stringify([body]))

    return `${id} queued for ${name}; ${await runScript($, 'start', t)}. The lane picks it up when it opens.`
  }
  await $.fs.write(queueFile(t), JSON.stringify([...queued, body]))
  if (isLive) return `${id} queued for ${name} (${queued.length + 1} waiting); it goes over when ${taskId(state?.task ?? '')} is done.`
  const opened = await runScript($, 'start', t)

  return `${id} queued for ${name}; ${opened}. The lane picks it up when it opens.`
}

// Main side, every poll: hand the next queued task to a live lane that has been
// idle a few seconds (a lane that just opened takes its queue itself first).
async function pump($: EngineInterface) {
  const now = await $.clock.now()
  const live = await peers($)
  for (const t of TIERS) {
    const queued = await readQueue($, t)
    if (queued.length === 0 || !live.has(laneName(t))) continue
    const s = await readLane($, t)
    if (s === undefined || s.state !== 'idle' || now - s.since < 10_000) continue
    const [next = '', ...rest] = queued
    await $.fs.write(queueFile(t), JSON.stringify(rest))
    await $.session.send({ to: laneName(t), text: next })
  }
}

async function poll($: EngineInterface) {
  await pump($)
  await refresh($)
}

async function drainQueue($: EngineInterface) {
  if (tier === undefined) return
  const queued = await readQueue($, tier)
  if (queued.length === 0) return
  await $.fs.write(queueFile(tier), '[]')
  for (const body of queued) await $.prompt.submit({ text: body })
}

// Closing a lane that is still on something leaves it stuck at "background
// tasks are running, exit anyway?" with every later message queued behind that.
async function closeIfIdle($: EngineInterface) {
  if (me === undefined || me.state !== 'idle') return
  const sessionId = me.sessionId
  const self = [...(await peers($)).values()].find(p => p.sessionId === sessionId)
  const owesReply = me.open === true && (await $.clock.now()) - me.since < cfg.idleMinutes * 3 * 60_000
  if (self?.status === 'waiting' || owesReply) {
    armIdle($)

    return
  }
  me.state = 'off'
  await save($)
  await $.command.run({ command: 'exit' })
}

function armIdle($: EngineInterface) {
  idleTimer?.cancel()
  idleTimer = cfg.idleMinutes > 0 ? $.clock.after(cfg.idleMinutes * 60_000, () => void closeIfIdle($)) : undefined
}

async function markBusy($: EngineInterface, from: string) {
  if (me === undefined) return
  idleTimer?.cancel()
  me.state = 'busy'
  me.since = await $.clock.now()
  // A turn raised by something other than a task (a background job finishing,
  // a reply from the other lane) carries on with the current task.
  const fresh = pending || (isTask(from) ? taskLine(from) : '')
  if (fresh !== '') {
    me.task = fresh
    me.open = true
  } else if (!isTask(me.task)) {
    me.task = taskLine(from) || '(continuing)'
  }
  me.next = []
  pending = ''
  await save($)
}

// A task that lands while the lane is on another one waits its turn in the state.
async function queueBehind($: EngineInterface, message: string) {
  if (me === undefined) return
  if (!isTask(me.task)) {
    me.task = taskLine(message)
  } else if (isTask(message)) {
    me.next = [...(me.next ?? []), taskLine(message)]
  } else {
    return
  }
  await save($)
}

// The lane's reply "[T7 PASS] ..." ends T7; the next waiting task becomes current.
// A note like "[T7] step 4 still running" is not a reply.
async function noteReply($: EngineInterface, message: unknown) {
  if (me === undefined || typeof message !== 'string') return
  const id = message.match(/^\s*\[([A-Z]\d+[a-z]?)\s+[A-Z]{3,}\b/)?.[1]
  if (id === undefined || id !== taskId(me.task)) return
  me.open = false
  const [head, ...rest] = me.next ?? []
  if (head === undefined) {
    await save($)

    return
  }
  me.open = true
  me.task = head
  me.next = rest
  me.since = await $.clock.now()
  await save($)
}

async function markIdle($: EngineInterface, answer: string) {
  if (me === undefined) return
  me.state = 'idle'
  me.since = await $.clock.now()
  me.next = []
  me.last = firstLine(answer)
  me.turns += 1
  await save($)
  armIdle($)
}

async function markOff($: EngineInterface) {
  if (me === undefined) return
  me.state = 'off'
  await save($)
}

async function startLane($: EngineInterface, t: Tier) {
  tier = t
  const sessionId = await $.session.id()
  const saved = await readLane($, t)
  // The plugin reloading inside a running lane keeps what the lane is doing.
  me = saved !== undefined && saved.sessionId === sessionId && saved.state !== 'off'
    ? saved
    : {
        tier: t,
        state: 'idle',
        since: await $.clock.now(),
        model: await $.session.model(),
        sessionId,
        task: '',
        last: '',
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0 },
      }
  await save($)
  $.ui.status(`${laneName(t)} lane · ${cfg[t].model}, effort ${cfg[t].effort} · replies go to whoever sent the task`)
  armIdle($)
  // Tasks queued while the lane was closed, once the session takes prompts.
  $.clock.after(3000, () => void drainQueue($))
}

async function startMain($: EngineInterface) {
  await $.command.register({
    name: 'lane',
    description: 'Run a request across the lane sessions, or: status, start/stop, mid <task>, low <task>',
    argumentHint: '[<request> | status | start | stop | mid <task> | low <task>]',
    immediate: true,
  })
  const lane = { type: 'string', enum: ['mid', 'low'], description: 'mid: tests, verification, reviews. low: search, scripts, crawling, notes.' }
  await $.tool.register({
    name: 'send',
    description: 'Hand a task to a lane session (opens it if closed). Returns the task id; the lane answers later as a message and writes its full report to .claude/lanes/out/<id>.md.',
    inputSchema: {
      type: 'object',
      properties: { lane, task: { type: 'string', description: 'The goal, the files or commands involved, and what counts as done.' } },
      required: ['lane', 'task'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'status',
    description: 'What each lane session is doing now, its last answer, token use and the newest reports.',
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'stop',
    description: 'Close a lane session now (they also close themselves when idle).',
    inputSchema: { type: 'object', properties: { lane: { ...lane, enum: ['mid', 'low', 'all'] } }, required: ['lane'] },
  })
  await refresh($)
  $.clock.every(POLL_MS, () => void poll($))
}

async function notePing($: EngineInterface, ping: string, from: string | undefined) {
  progress = { text: `${from ? `${from}: ` : ''}${ping}`.slice(0, 200), at: await $.clock.now() }
  await refresh($)
}

function failed() {
  return { deny: 'the lanes plugin failed on this call; run claude --debug to see why' }
}

async function setup($: EngineInterface, cwd: string) {
  project = cwd
  dir = `${cwd.replaceAll('\\', '/')}/.claude/lanes`
  slug = (cwd.split(/[\\/]/).filter(Boolean).pop() ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const userHome = isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
  home = (configDir ?? `${userHome ?? ''}/.claude`).replaceAll('\\', '/')
  pluginRoot = $.plugin.root
}

export const register: Register = (on, options) => {
  configure(options as Readonly<Record<string, unknown>>)

  on('session.start', async ($, e, next) => {
    await setup($, e.cwd)
    // Only the interactive session is the lane or the main session. A `claude -p`
    // that another plugin's hook starts inherits CLAUDE_LANE from the lane's
    // shell, and must not write the lane's state.
    const role = await $.env.get('CLAUDE_LANE')
    if (!e.isInteractive) {
      // neither
    } else if (role === 'mid' || role === 'low') {
      spend = await readSpend($, role)
      await startLane($, role)
    } else {
      isMain = true
      spend = await readSpend($, 'main')
      await startMain($)
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!isMain) return composed

    return { sections: [...composed.sections, { id: 'lanes:policy', text: policy(), scope: 'session' as const }] }
  })

  on('session.receive', async ($, e, next) => {
    if (tier !== undefined) {
      // A message that lands mid-turn joins that turn and raises no turn.start.
      if (me?.state === 'busy') {
        await queueBehind($, e.text)
      } else {
        pending = taskLine(e.text)
      }

      return next(e)
    }
    // A lane's "[progress] ..." ping goes to the status line instead of waking the main model.
    const ping = e.text.match(/^\s*\[progress\]\s*(.+)$/m)
    if (ping === null) return next(e)
    await notePing($, ping[1] ?? '', e.text.match(/from-name="([^"]+)"/)?.[1])

    return { consumed: 'lane progress ping, shown in the status line' }
  })

  on('turn.start', async ($, e, next) => {
    await markBusy($, e.text)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const effort = stepEffort(e.model, e.effort, e.agentId)
    const done = yield* next(effort === undefined ? e : { ...e, effort })
    await record($, done.usage)

    return done
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await markIdle($, e.answer)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await markOff($)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__lanes__send' }, async ($, e) => {
    const input = e as unknown as { lane?: string; task?: string }
    if ((input.lane !== 'mid' && input.lane !== 'low') || !input.task) return { result: 'lane must be mid or low, and task is required' }

    return { result: await dispatch($, input.lane, input.task) }
  }).catch(failed)

  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const sent = await next(e)
    if (tier !== undefined) await noteReply($, (e as unknown as { message?: unknown }).message)

    return sent
  })

  on('tool.call', { tool: 'mcp__lanes__status' }, async $ => ({ result: await report($) })).catch(failed)

  on('tool.call', { tool: 'mcp__lanes__stop' }, async ($, e) => {
    const which = (e as unknown as { lane?: string }).lane

    return { result: await runScript($, 'stop', which === 'mid' || which === 'low' ? which : 'all') }
  }).catch(failed)

  on('command.run', { command: 'lane' }, async ($, e) => {
    const args = e.args.trim()
    const verb = args.split(/\s+/)[0] || 'status'
    const rest = args.slice(verb.length).trim()

    if (verb === 'status') return { text: await report($) }
    if (verb === 'usage' && /^(all|today)?$/.test(rest)) return { text: await spendReport($, rest === 'all') }
    if (verb === 'help') return { text: USAGE }
    if ((verb === 'start' || verb === 'stop') && /^(mid|low|all)?$/.test(rest)) {
      return { text: await runScript($, verb, rest === 'mid' || rest === 'low' ? rest : 'all') }
    }
    if ((verb === 'mid' || verb === 'low') && rest !== '') return { text: await dispatch($, verb, rest) }

    // Anything else is a request for the main model to run across the lanes,
    // submitted once this command has returned (a command can't wait on a turn).
    $.clock.after(50, () => void submitRequest($, args))

    return { text: 'Handed to the main session to run across the lanes.' }
  })
}

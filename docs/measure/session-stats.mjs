// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai
//
// What one main session and the lanes beside it spent, from the session transcripts:
// every model request once (by message id), priced at API list rates as register.ts does,
// and what the lanes' requests would have cost on Opus 5.5. Also when each side was busy
// (requests less than 4 minutes apart make one stretch), when each lane task came in, what
// main would have paid to carry the lanes' reading through its later requests (`carry`, an
// estimate), and what main did itself (`mainWork`: its lookups, commands, browser steps, edits).
//
//   node session-stats.mjs ~/.claude/projects/<project folder> <main session id> [until, ISO time]
//
// The project folder is the project's path with every non-letter as "-" (C--Users-me-Desktop-app).
// Without a session id it lists the main sessions there (unnamed ones), newest first.
// A lane is any other session there with a name: <project>-mid or <project>-low, or else one whose
// model is a Sonnet or a Haiku; unnamed one-off calls other tools make (summaries, say) are left out.
// A request a gateway answers under a model name of its own (a Bedrock application inference
// profile's ARN, an alias) is priced as the lane that answered under the same name ran: a name
// the mid lane's requests carry is Sonnet 5.5's, the low lane's Haiku 5.5's, so main's requests
// while it was switched to Sonnet are priced as Sonnet (`pricedByLaneName` counts them). Any other
// is priced as its session's model: Opus 5.5 for main (`pricedBySession` counts them).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [dir, mainId, untilIso] = process.argv.slice(2)
const until = untilIso ? Date.parse(untilIso) : Infinity
const SESSION_MODEL = { main: 'claude-opus-5-5', mid: 'claude-sonnet-5-5', low: 'claude-haiku-5-5' }

const PRICES = [
  [/fable-5-1|mythos-5-1/, [10, 20, 0.25, 50]],
  [/fable-5|mythos-5/, [10, 20, 1, 50]],
  [/opus-5-5/, [4, 8, 0.2, 20]],
  [/opus-5|opus-4-[5-8]/, [5, 10, 0.5, 25]],
  [/sonnet-5-5/, [2, 4, 0.1, 10]],
  [/sonnet-5/, [2, 4, 0.2, 10]],
  [/sonnet-4-[56]/, [3, 6, 0.3, 15]],
  [/haiku-5-5/, [0.1, 0.2, 0.01, 0.5], [0.5, 1, 0.05, 2.5]],
  [/haiku-4-5/, [1, 2, 0.1, 5]],
]
function price(model, u) {
  const hit = PRICES.find(([re]) => re.test(model))
  if (!hit) return undefined
  const write = u.cache_creation_input_tokens ?? 0
  const prompt = u.input_tokens + write + (u.cache_read_input_tokens ?? 0)
  const [i, w, r, o] = (prompt > 100_000 ? hit[2] : undefined) ?? hit[1]

  return (u.input_tokens * i + write * w + (u.cache_read_input_tokens ?? 0) * r + u.output_tokens * o) / 1e6
}

function* jsonl(path) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { yield JSON.parse(line) } catch {}
  }
}

// the requests of one transcript file, last record per message id
function requests(path, info = {}) {
  const byId = new Map()
  for (const r of jsonl(path)) {
    if (r.agentName && !info.name) info.name = r.agentName
    const m = r.message
    if (r.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue
    byId.set(m.id ?? r.uuid, { at: Date.parse(r.timestamp), model: m.model, usage: m.usage, session: r.sessionId })
  }

  return [...byId.values()]
}

if (!mainId) {
  const rows = readdirSync(dir).filter(f => f.endsWith('.jsonl')).flatMap(f => {
    const info = {}
    const reqs = requests(join(dir, f), info)
    if (info.name || reqs.length === 0) return []
    const at = reqs.map(r => r.at)

    return [{ id: f.slice(0, -6), first: Math.min(...at), last: Math.max(...at), calls: reqs.length }]
  })
  for (const r of rows.sort((a, b) => b.last - a.last).slice(0, 10)) {
    console.log(`${r.id}  ${new Date(r.first).toISOString().slice(0, 16)} – ${new Date(r.last).toISOString().slice(11, 16)}  ${r.calls} requests`)
  }
  process.exit(0)
}

const mainFile = join(dir, `${mainId}.jsonl`)
const mainReqs = requests(mainFile)
const start = Math.min(...[...jsonl(mainFile)].map(r => Date.parse(r.timestamp)).filter(Number.isFinite))
const end = Math.min(until, Math.max(...mainReqs.map(r => r.at)))

const roles = { main: [], 'main subagents': [], mid: [], low: [] }
roles.main = mainReqs.filter(r => r.at <= end)
const subDir = join(dir, mainId, 'subagents')
if (existsSync(subDir)) for (const f of readdirSync(subDir).filter(f => f.endsWith('.jsonl'))) roles['main subagents'].push(...requests(join(subDir, f)).filter(r => r.at >= start && r.at <= end))
for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl') && !f.startsWith(mainId))) {
  const path = join(dir, f)
  if (statSync(path).mtimeMs < start) continue
  // only named sessions are lanes; one-off helper calls by other tools are not
  const info = {}
  const reqs = requests(path, info)
  if (!info.name) continue
  const lane = /-mid$/.test(info.name) ? 'mid' : /-low$/.test(info.name) ? 'low' : undefined
  for (const r of reqs) {
    if (r.at < start || r.at > end) continue
    const role = lane ?? (/sonnet/.test(r.model) ? 'mid' : /haiku/.test(r.model) ? 'low' : undefined)
    if (role) roles[role].push(r)
  }
}

// a gateway's own model name -> the model of the lane whose requests carry it
const laneName = new Map()
for (const role of ['mid', 'low']) for (const r of roles[role]) if (price(r.model, r.usage) === undefined) laneName.set(r.model, SESSION_MODEL[role])

const sum = (reqs, role) => {
  const s = { calls: reqs.length, cost: 0, onOpus: 0, tokensIn: 0, output: 0, first: Infinity, last: 0, models: new Set(), pricedByLaneName: 0, pricedBySession: 0, unpriced: 0 }
  for (const r of reqs) {
    const own = price(r.model, r.usage)
    const byLane = own === undefined && laneName.has(r.model) ? price(laneName.get(r.model), r.usage) : undefined
    const bySession = own === undefined && byLane === undefined && SESSION_MODEL[role] ? price(SESSION_MODEL[role], r.usage) : undefined
    s.pricedByLaneName += byLane === undefined ? 0 : 1
    s.pricedBySession += bySession === undefined ? 0 : 1
    s.unpriced += own === undefined && byLane === undefined && bySession === undefined ? 1 : 0
    s.cost += own ?? byLane ?? bySession ?? 0
    s.onOpus += price('claude-opus-5-5', r.usage) ?? 0
    s.tokensIn += r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0)
    s.output += r.usage.output_tokens
    s.first = Math.min(s.first, r.at); s.last = Math.max(s.last, r.at)
    s.models.add(r.model)
  }

  return s
}

// Busy spans: requests closer than 4 minutes apart are one stretch of work.
const GAP = 4 * 60_000
const spansOf = reqs => {
  const spans = []
  for (const t of reqs.map(r => r.at).sort((a, b) => a - b)) {
    const last = spans.at(-1)
    if (last && t - last[1] < GAP) last[1] = t
    else spans.push([t, t])
  }

  return spans
}
const length = spans => spans.reduce((a, [s, e]) => a + (e - s), 0)
const overlap = (as, bs) => {
  let n = 0
  for (const [a0, a1] of as) for (const [b0, b1] of bs) n += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

  return n
}
// a lane's tasks as they arrived: "[T7] ..." at the start of a prompt
const tasks = []
const taskFile = new Map()
for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl') && !f.startsWith(mainId))) {
  const path = join(dir, f)
  if (statSync(path).mtimeMs < start) continue
  let name = ''
  for (const r of jsonl(path)) {
    if (r.agentName && !name) name = r.agentName
    const c = typeof r.message?.content === 'string' ? r.message.content : ''
    const at = Date.parse(r.timestamp)
    const m = r.type === 'user' ? c.match(/^\s*(?:(?:The lanes plugin|Another Claude session) sent a message:\s*)?(?:<[^>]*>\s*)?\[(T\d+[a-z]?)\]/) : null
    if (m && name && at >= start && at <= end) tasks.push({ id: m[1], lane: /sonnet|mid/.test(name) ? 'mid' : 'low', at })
    if (m && name && at >= start && at <= end) taskFile.set(`${m[1]}@${at}`, path)
  }
}
const seenTask = new Set()
const taskList = tasks.sort((a, b) => a.at - b.at).filter(t => (seenTask.has(t.id) ? false : (seenTask.add(t.id), true)))

// What main would have carried had it read each task's material itself, as lanes 0.3.9's
// /lane usage works it out: the lane's prompt grew by what it read for the task (request by
// request, so a compaction of the lane's mid-task loses none of it); each main request after the
// answer would have read that again, until main's context, that much fuller, reached the size it
// compacted at and started over.
const promptOf = u => u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
const mainSorted = [...roles.main].sort((a, b) => a.at - b.at)
// An automatic compaction shows where main's context fills; one by hand (/compact) can come
// anywhere, and the point an automatic one last showed still stands at it.
const compactions = [...jsonl(mainFile)].filter(r => r.type === 'system' && r.subtype === 'compact_boundary' && Date.parse(r.timestamp) <= end).map(r => ({ at: Date.parse(r.timestamp), pre: r.compactMetadata?.preTokens ?? 0, trigger: r.compactMetadata?.trigger ?? 'auto' }))
let fills = 0
for (const c of compactions) {
  if (c.trigger === 'auto') fills = c.pre
  c.cap = Math.max(fills, c.pre)
}
const carry = []
for (const t of taskList) {
  const path = taskFile.get(`${t.id}@${t.at}`)
  const laneReqs = requests(path).sort((a, b) => a.at - b.at)
  const nextAt = tasks.filter(x => taskFile.get(`${x.id}@${x.at}`) === path && x.at > t.at).map(x => x.at).sort((a, b) => a - b)[0] ?? Infinity
  const mine = laneReqs.filter(r => r.at >= t.at && r.at < nextAt && r.at <= end)
  if (mine.length === 0) continue
  let read = 0
  for (let i = 1; i < mine.length; i++) read += Math.max(0, promptOf(mine[i].usage) - promptOf(mine[i - 1].usage))
  const answered = mine.at(-1).at
  const boundary = compactions.find(c => c.at > answered)
  const after = mainSorted.filter(r => r.at > answered && (boundary === undefined || r.at < boundary.at))
  // with no compaction after it, main's context fills where the last automatic one came, or else
  // where it got to at the latest; and never below the most it went on to hold without starting over
  const cap = Math.max(boundary?.cap ?? fills, ...after.map(r => promptOf(r.usage)), 0)
  const full = after.findIndex(r => promptOf(r.usage) + read >= cap)
  const later = full === -1 ? after.length : full
  carry.push({ id: t.id, lane: t.lane, read, requests: later, cost: (read * later * 0.2) / 1e6 })
}

// What main did itself: its own tool calls by kind, and the characters of output its lookups
// and commands brought into its context. A shell command counts as a lookup when it starts
// with a read-only command (the plugin asks Claude Code instead, which a transcript doesn't keep).
const LOOK_CMD = /^(?:grep|rg|find|ls|dir|tree|cat|type|head|tail|less|wc|du|stat|file|which|where|sed\s+-n|awk|jq|diff|git\s+(?:log|show|diff|status|blame|grep|ls-files)|Get-Content|gc|Select-String|Get-ChildItem|gci|Get-Item|Test-Path)\b/i
const commandOf = c => String(c ?? '').trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s*;?\s*)+/, '')
const laneNames = new Set()
for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl') && !f.startsWith(mainId))) {
  const info = {}
  requests(join(dir, f), info)
  if (info.name && /-(?:mid|low)$/.test(info.name)) laneNames.add(info.name)
}
const work = { look: 0, command: 0, browse: 0, edit: 0, handoff: 0, tookChars: 0 }
const kindOf = new Map()
for (const r of jsonl(mainFile)) {
  const at = Date.parse(r.timestamp)
  if (at > end || !Array.isArray(r.message?.content)) continue
  for (const c of r.message.content) {
    if (r.type === 'assistant' && c.type === 'tool_use') {
      const n = c.name
      const kind = /^mcp__.*(?:chrome|playwright|browser|puppeteer)/i.test(n) ? 'browse'
        : n === 'mcp__lanes__send' || (n === 'SendMessage' && laneNames.has(c.input?.to)) ? 'handoff'
        : /^(?:Write|Edit|MultiEdit|NotebookEdit)$/.test(n) ? 'edit'
        : /^(?:Read|Grep|Glob|WebFetch|WebSearch)$/.test(n) || /^mcp__context7__/.test(n) ? 'look'
        : n === 'Bash' || n === 'PowerShell' ? (LOOK_CMD.test(commandOf(c.input?.command)) ? 'look' : 'command')
        : undefined
      if (kind) { work[kind] += 1; kindOf.set(c.id, kind) }
    }
    if (r.type === 'user' && c.type === 'tool_result' && ['look', 'command'].includes(kindOf.get(c.tool_use_id))) {
      work.tookChars += (typeof c.content === 'string' ? c.content : (c.content ?? []).map(x => x.text ?? '').join('')).length
    }
  }
}
const mainSpans = spansOf(roles.main)
const laneSpans = { mid: spansOf(roles.mid), low: spansOf(roles.low) }

const out = {
  start: new Date(start).toISOString(), end: new Date(end).toISOString(), hours: (end - start) / 3_600_000, roles: {},
  startMs: start, endMs: end, mainSpans, laneSpans, tasks: taskList,
  busyMin: { main: length(mainSpans) / 60_000, mid: length(laneSpans.mid) / 60_000, low: length(laneSpans.low) / 60_000 },
  parallelMin: (overlap(mainSpans, laneSpans.mid) + overlap(mainSpans, laneSpans.low)) / 60_000,
}
for (const [k, v] of Object.entries(roles)) {
  const s = sum(v, k)
  out.roles[k] = { ...s, models: [...s.models], first: s.calls ? new Date(s.first).toISOString() : null, last: s.calls ? new Date(s.last).toISOString() : null }
}
const lanes = ['mid', 'low'].map(k => out.roles[k])
out.lanes = { calls: lanes.reduce((a, s) => a + s.calls, 0), cost: lanes.reduce((a, s) => a + s.cost, 0), onOpus: lanes.reduce((a, s) => a + s.onOpus, 0), tokensIn: lanes.reduce((a, s) => a + s.tokensIn, 0) }
const all = ['main', 'main subagents'].map(k => out.roles[k])
out.total = { cost: all.reduce((a, s) => a + s.cost, 0) + out.lanes.cost, allOnOpus: all.reduce((a, s) => a + s.cost, 0) + out.lanes.onOpus }
out.carry = { tasks: carry, cost: carry.reduce((a, c) => a + c.cost, 0), compactions: compactions.map(c => ({ at: new Date(c.at).toISOString(), pre: c.pre, trigger: c.trigger })) }
out.mainWork = work
console.log(JSON.stringify(out, null, 1))

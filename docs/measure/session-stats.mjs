// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai
//
// What one main session and the lanes beside it spent, from the session transcripts:
// every model request once (by message id), priced at API list rates as register.ts does,
// and what the lanes' requests would have cost on Opus 5.5. Also when each side was busy
// (requests less than 4 minutes apart make one stretch) and when each lane task came in.
//
//   node session-stats.mjs ~/.claude/projects/<project folder> <main session id> [until, ISO time]
//
// The project folder is the project's path with every non-letter as "-" (C--Users-me-Desktop-app).
// Without a session id it lists the main sessions there (unnamed ones), newest first.
// A lane is any other session there with a name: <project>-mid or <project>-low, or else one whose
// model is a Sonnet or a Haiku; unnamed one-off calls other tools make (summaries, say) are left out.
// A request a gateway answers under a model name of its own (a Bedrock application inference
// profile's ARN, an alias) is priced as its session's model: Opus 5.5 for main, Sonnet 5.5 for the
// mid lane, Haiku 5.5 for the low lane; `pricedBySession` counts them.
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

const sum = (reqs, role) => {
  const s = { calls: reqs.length, cost: 0, onOpus: 0, tokensIn: 0, output: 0, first: Infinity, last: 0, models: new Set(), pricedBySession: 0, unpriced: 0 }
  for (const r of reqs) {
    const own = price(r.model, r.usage)
    const bySession = own === undefined && SESSION_MODEL[role] ? price(SESSION_MODEL[role], r.usage) : undefined
    s.pricedBySession += bySession === undefined ? 0 : 1
    s.unpriced += own === undefined && bySession === undefined ? 1 : 0
    s.cost += own ?? bySession ?? 0
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
  }
}
const seenTask = new Set()
const taskList = tasks.sort((a, b) => a.at - b.at).filter(t => (seenTask.has(t.id) ? false : (seenTask.add(t.id), true)))
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
console.log(JSON.stringify(out, null, 1))

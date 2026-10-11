// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 jysvai

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The ground beneath the plugin: a Windows machine, an empty project, and a
// model request that records the effort it was finally sent with.
function ground(on: On, env: Record<string, string>, seen: { effort?: unknown }) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me', ...env })
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'no such file' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-haiku-5-5' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'lane' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__lanes__send' } }))
  on('turn.step', async function* ($, e) {
    seen.effort = e.effort

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

async function step($: Engine, model: string, effort: string, agentId?: string) {
  await $.session.start({ cwd: 'C:/work/demo', surface: 'terminal', isInteractive: true })
  const stream = $.turn.step({ turnId: 't1', index: 0, model, effort: effort as 'low', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
}

describe('effort', () => {
  test('the low lane runs at medium whatever the session was set to', async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, { CLAUDE_LANE: 'low' }, seen)
    await step($, 'claude-haiku-5-5', 'low')
    expect(seen.effort).toBe('medium')
  })

  test('the mid lane runs at high', async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, { CLAUDE_LANE: 'mid' }, seen)
    await step($, 'claude-sonnet-5-5', 'medium')
    expect(seen.effort).toBe('high')
  })

  test('a lane follows the effort set in /config', { options: { low_effort: 'low' } }, async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, { CLAUDE_LANE: 'low' }, seen)
    await step($, 'claude-haiku-5-5', 'medium')
    expect(seen.effort).toBe('low')
  })

  test('an Opus main session never drops below xhigh', async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, {}, seen)
    await step($, 'claude-opus-5-5', 'high')
    expect(seen.effort).toBe('xhigh')
  })

  test('max on the main session stays max', async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, {}, seen)
    await step($, 'claude-opus-5-5', 'max')
    expect(seen.effort).toBe('max')
  })

  test('a main session on another model keeps its own effort', async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, {}, seen)
    await step($, 'claude-haiku-5-5', 'low')
    expect(seen.effort).toBe('low')
  })

  test("a subagent's requests are left alone", async ($, on) => {
    const seen: { effort?: unknown } = {}
    ground(on, { CLAUDE_LANE: 'low' }, seen)
    await step($, 'claude-haiku-5-5', 'low', 'agent-1')
    expect(seen.effort).toBe('low')
  })
})

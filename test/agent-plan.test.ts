import { describe, it, expect } from 'vitest'

// Import the web-side trace builders directly; these are pure functions
import { buildTraces, parseProtoEvents, type AgentTrace } from '../web/src/lib/agent-trace'

function lines(xs: string[]) {
  return xs.join('\n')
}

describe('buildTraces: update_plan parsing', () => {
  it('parses a single update_plan into trace.plan with explanation and timestamps', () => {
    const log = lines([
      JSON.stringify({ id: 'r1', ts: 1000, msg: { type: 'task_started' } }),
      JSON.stringify({
        id: 'r1',
        ts: 1001,
        msg: {
          type: 'update_plan',
          explanation: 'Large task; tracking steps',
          plan: [
            { step: 'Scan repo', status: 'completed' },
            { step: 'Implement feature', status: 'in_progress' },
            { step: 'Write tests', status: 'pending' },
          ],
        },
      }),
      JSON.stringify({ id: 'r1', ts: 1100, msg: { type: 'task_complete' } }),
    ])
    const events = parseProtoEvents(log)
    const traces = buildTraces(events)
    const t = traces.get('r1') as AgentTrace
    expect(t).toBeTruthy()
    expect(t.plan).toBeTruthy()
    expect(t.plan?.items.length).toBe(3)
    expect(t.plan?.explanation).toBe('Large task; tracking steps')
    expect(t.plan?.updatedAt).toBe(1001)
    // Statuses preserved
    expect(t.plan?.items[0]).toEqual({ step: 'Scan repo', status: 'completed' })
    expect(t.plan?.items[1]).toEqual({ step: 'Implement feature', status: 'in_progress' })
    expect(t.plan?.items[2]).toEqual({ step: 'Write tests', status: 'pending' })
  })

  it('later plan updates replace the previous snapshot', () => {
    const log = lines([
      JSON.stringify({ id: 'r1', ts: 1001, msg: { type: 'update_plan', explanation: 'v1', plan: [ { step: 'A', status: 'in_progress' } ] } }),
      JSON.stringify({ id: 'r1', ts: 1002, msg: { type: 'update_plan', plan: [ { step: 'A', status: 'completed' }, { step: 'B', status: 'in_progress' } ] } }),
    ])
    const events = parseProtoEvents(log)
    const traces = buildTraces(events)
    const t = traces.get('r1') as AgentTrace
    expect(t.plan?.items.length).toBe(2)
    // Explanation replaced by lack-of-explanation (undefined) on second update
    expect(t.plan?.explanation).toBeUndefined()
    expect(t.plan?.updatedAt).toBe(1002)
    expect(t.plan?.items[0]).toEqual({ step: 'A', status: 'completed' })
    expect(t.plan?.items[1]).toEqual({ step: 'B', status: 'in_progress' })
  })

  it('ignores invalid/empty plan payloads and keeps the previous valid snapshot', () => {
    const log = lines([
      JSON.stringify({ id: 'r1', ts: 1001, msg: { type: 'update_plan', plan: [ { step: 'A', status: 'in_progress' } ] } }),
      // Invalid: unknown status
      JSON.stringify({ id: 'r1', ts: 1002, msg: { type: 'update_plan', plan: [ { step: 'A', status: 'done' } ] } }),
      // Invalid: empty list
      JSON.stringify({ id: 'r1', ts: 1003, msg: { type: 'update_plan', plan: [] } }),
    ])
    const events = parseProtoEvents(log)
    const traces = buildTraces(events)
    const t = traces.get('r1') as AgentTrace
    expect(t.plan?.items.length).toBe(1)
    expect(t.plan?.items[0]).toEqual({ step: 'A', status: 'in_progress' })
    expect(t.plan?.updatedAt).toBe(1001)
  })

  it('supports task_plan as an alias of update_plan', () => {
    const log = lines([
      JSON.stringify({ id: 'r2', ts: 2000, msg: { type: 'task_plan', plan: [ { step: 'X', status: 'pending' } ] } }),
    ])
    const events = parseProtoEvents(log)
    const traces = buildTraces(events)
    const t = traces.get('r2') as AgentTrace
    expect(t.plan?.items.length).toBe(1)
    expect(t.plan?.items[0]).toEqual({ step: 'X', status: 'pending' })
    expect(t.plan?.updatedAt).toBe(2000)
  })
})


import { describe, expect, it } from 'vitest'
import { validateFlowCycles } from './cycle-validation'

describe('validateFlowCycles', () => {
  it('allows an acyclic flow', () => {
    const issues = validateFlowCycles([
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'message' } },
      { node_key: 'message', node_type: 'send_message', config: { text: 'Olá', next_node_key: 'end' } },
      { node_key: 'end', node_type: 'end', config: {} },
    ])

    expect(issues).toEqual([])
  })

  it('blocks a direct self-cycle', () => {
    const issues = validateFlowCycles([
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'start' } },
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toEqual(expect.objectContaining({
      severity: 'error',
      node_key: 'start',
    }))
    expect(issues[0].message).toContain('start → start')
  })

  it('blocks an indirect cycle across several nodes', () => {
    const issues = validateFlowCycles([
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'a' } },
      { node_key: 'a', node_type: 'send_message', config: { text: 'A', next_node_key: 'b' } },
      { node_key: 'b', node_type: 'condition', config: { true_next: 'c', false_next: 'end' } },
      { node_key: 'c', node_type: 'set_tag', config: { mode: 'add', tag_id: 'tag', next_node_key: 'a' } },
      { node_key: 'end', node_type: 'end', config: {} },
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(issues[0].message).toContain('a → b → c → a')
  })

  it('detects cycles through button and list branches', () => {
    const issues = validateFlowCycles([
      {
        node_key: 'menu',
        node_type: 'send_buttons',
        config: {
          buttons: [{ reply_id: 'go', title: 'Go', next_node_key: 'list' }],
        },
      },
      {
        node_key: 'list',
        node_type: 'send_list',
        config: {
          sections: [{ rows: [{ reply_id: 'back', title: 'Back', next_node_key: 'menu' }] }],
        },
      },
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('menu')
    expect(issues[0].message).toContain('list')
  })

  it('ignores dangling references because the main validator reports them separately', () => {
    const issues = validateFlowCycles([
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'missing' } },
    ])

    expect(issues).toEqual([])
  })
})

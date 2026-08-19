import type { ValidationIssue } from './validate'

interface FlowNodeLike {
  node_key: string
  node_type: string
  config: Record<string, unknown>
}

function outgoingEdges(node: FlowNodeLike): string[] {
  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag': {
      const cfg = node.config as { next_node_key?: string }
      return cfg.next_node_key ? [cfg.next_node_key] : []
    }
    case 'condition': {
      const cfg = node.config as { true_next?: string; false_next?: string }
      return [cfg.true_next, cfg.false_next].filter((key): key is string => Boolean(key))
    }
    case 'send_buttons': {
      const cfg = node.config as { buttons?: Array<{ next_node_key?: string }> }
      return (cfg.buttons ?? [])
        .map((button) => button.next_node_key)
        .filter((key): key is string => Boolean(key))
    }
    case 'send_list': {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>
      }
      const edges: string[] = []
      for (const section of cfg.sections ?? []) {
        for (const row of section.rows ?? []) {
          if (row.next_node_key) edges.push(row.next_node_key)
        }
      }
      return edges
    }
    default:
      return []
  }
}

/**
 * Returns one activation-blocking issue per directed cycle.
 *
 * The runtime keeps its iteration ceiling as a defence-in-depth fallback,
 * but authored cyclic graphs are rejected before activation so customers
 * never enter a flow that can spin until that ceiling is reached.
 */
export function validateFlowCycles(nodes: FlowNodeLike[]): ValidationIssue[] {
  const byKey = new Map(nodes.map((node) => [node.node_key, node] as const))
  const state = new Map<string, 0 | 1 | 2>() // 0 unseen, 1 visiting, 2 done
  const stack: string[] = []
  const stackIndex = new Map<string, number>()
  const cycles = new Map<string, string[]>()

  const canonicalCycleKey = (cycle: string[]) => {
    const ring = cycle.slice(0, -1)
    if (ring.length === 0) return cycle.join('>')
    const rotations = ring.map((_, index) => {
      const rotated = [...ring.slice(index), ...ring.slice(0, index)]
      return rotated.join('>')
    })
    return rotations.sort()[0]
  }

  const visit = (key: string) => {
    const current = state.get(key) ?? 0
    if (current === 2) return
    if (current === 1) return

    state.set(key, 1)
    stackIndex.set(key, stack.length)
    stack.push(key)

    const node = byKey.get(key)
    if (node) {
      for (const next of outgoingEdges(node)) {
        if (!byKey.has(next)) continue
        const nextState = state.get(next) ?? 0
        if (nextState === 0) {
          visit(next)
          continue
        }
        if (nextState === 1) {
          const start = stackIndex.get(next)
          if (start === undefined) continue
          const cycle = [...stack.slice(start), next]
          cycles.set(canonicalCycleKey(cycle), cycle)
        }
      }
    }

    stack.pop()
    stackIndex.delete(key)
    state.set(key, 2)
  }

  for (const node of nodes) visit(node.node_key)

  return Array.from(cycles.values()).map((cycle) => ({
    severity: 'error' as const,
    scope: 'node' as const,
    node_key: cycle[0],
    field: 'next_node_key',
    message: `Flow cycle detected: ${cycle.join(' → ')}. Cycles must be removed before activation.`,
  }))
}

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentTraceCollector } from './trace'

const traceStorage = new AsyncLocalStorage<AgentTraceCollector>()

export function enterAgentTraceContext(trace: AgentTraceCollector): void {
  traceStorage.enterWith(trace)
}

export function getAgentTraceContext(): AgentTraceCollector | null {
  return traceStorage.getStore() ?? null
}

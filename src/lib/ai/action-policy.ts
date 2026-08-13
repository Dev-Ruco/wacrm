import type { AgentToolDefinition, ChatMessage, CommercialStrategy } from './types'

export function toolsAllowedForTurn(args: {
  tools?: AgentToolDefinition[]
  messages: ChatMessage[]
  strategy?: CommercialStrategy
}): AgentToolDefinition[] | undefined {
  return args.tools
}

export type AgentActionClass = 'read' | 'present' | 'write' | 'escalate'

/** Platform semantics only; no tenant or business vocabulary belongs here. */
export const TOOL_ACTION_CLASS: Readonly<Record<string, AgentActionClass>> = {
  search_catalog: 'read',
  search_knowledge: 'read',
  get_style_opinion: 'read',
  send_product: 'present',
  add_tag: 'write',
  create_deal: 'write',
  schedule_visit: 'write',
  handoff_human: 'escalate',
}

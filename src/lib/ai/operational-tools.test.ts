import { describe, expect, it } from 'vitest'
import { AGENT_TOOL_KEYS, DEFAULT_AGENT_TOOLS, restrictToPreviewSafe } from './tool-permissions'

describe('operational agent tool registration', () => {
  it('registers the operational capabilities in the runtime authority list', () => {
    expect(AGENT_TOOL_KEYS).toEqual(expect.arrayContaining([
      'check_availability',
      'create_order',
      'get_order_status',
      'update_contact',
    ]))
  })

  it('keeps operational mutations opt-in while allowing safe reads by default', () => {
    expect(DEFAULT_AGENT_TOOLS.check_availability).toBe(true)
    expect(DEFAULT_AGENT_TOOLS.get_order_status).toBe(true)
    expect(DEFAULT_AGENT_TOOLS.create_order).toBe(false)
    expect(DEFAULT_AGENT_TOOLS.update_contact).toBe(false)
  })

  it('keeps order/contact mutations out of preview surfaces', () => {
    const permissions = Object.fromEntries(
      AGENT_TOOL_KEYS.map((key) => [key, true]),
    )
    const restricted = restrictToPreviewSafe(permissions)
    expect(restricted.check_availability).toBe(true)
    expect(restricted.get_order_status).toBe(true)
    expect(restricted.create_order).toBe(false)
    expect(restricted.update_contact).toBe(false)
  })
})

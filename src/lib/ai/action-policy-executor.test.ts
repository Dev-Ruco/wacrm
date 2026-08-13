import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import { executorWithTenantPolicy } from './action-policy'

describe('executorWithTenantPolicy', () => {
  it('caps presentation actions per tenant setting without blocking reads', async () => {
    const executeTool = vi.fn(async () => JSON.stringify({ ok: true }))
    const wrapped = executorWithTenantPolicy({
      executeTool,
      strategy: { ...DEFAULT_COMMERCIAL_STRATEGY, maxProducts: 2 },
    })!

    await wrapped({ id: '1', name: 'search_catalog', arguments: '{}' })
    await wrapped({ id: '2', name: 'send_product', arguments: '{}' })
    await wrapped({ id: '3', name: 'send_product', arguments: '{}' })
    const blocked = JSON.parse(
      await wrapped({ id: '4', name: 'send_product', arguments: '{}' }),
    )

    expect(blocked).toMatchObject({ ok: false, policy_blocked: true })
    expect(executeTool).toHaveBeenCalledTimes(3)
  })
})

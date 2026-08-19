import { describe, expect, it, vi } from 'vitest'
import {
  freshWebsiteActivity,
  setWebsiteActivity,
  setWebsiteActivityIfWebsite,
} from './activity'

describe('website activity', () => {
  it('does not query Postgres for an empty conversation id', async () => {
    const from = vi.fn(() => {
      throw new Error('database should not be touched')
    })
    const db = { from } as never

    await expect(setWebsiteActivity(db, '', 'searching_catalog')).resolves.toBeUndefined()
    await expect(setWebsiteActivityIfWebsite(db, '', 'writing')).resolves.toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('does not query Postgres for a malformed conversation id', async () => {
    const from = vi.fn(() => {
      throw new Error('database should not be touched')
    })
    const db = { from } as never

    await expect(setWebsiteActivity(db, 'not-a-uuid', 'analyzing')).resolves.toBeUndefined()
    await expect(setWebsiteActivityIfWebsite(db, 'not-a-uuid', null)).resolves.toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects stale activity state', () => {
    expect(
      freshWebsiteActivity({
        state: 'writing',
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toBeNull()
  })
})

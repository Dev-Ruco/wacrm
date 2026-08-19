import { describe, expect, it } from 'vitest'
import { rankAutomationAssignees } from './assignment'

describe('rankAutomationAssignees', () => {
  it('prefers the least-loaded eligible member', () => {
    expect(rankAutomationAssignees([
      { userId: 'b', openCount: 3 },
      { userId: 'a', openCount: 1 },
      { userId: 'c', openCount: 2 },
    ]).map((item) => item.userId)).toEqual(['a', 'c', 'b'])
  })

  it('uses user id as a stable tie-breaker', () => {
    expect(rankAutomationAssignees([
      { userId: 'c', openCount: 1 },
      { userId: 'a', openCount: 1 },
      { userId: 'b', openCount: 1 },
    ]).map((item) => item.userId)).toEqual(['a', 'b', 'c'])
  })
})

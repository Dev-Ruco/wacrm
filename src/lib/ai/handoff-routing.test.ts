import { describe, expect, it } from 'vitest'
import { rankHandoffCandidates } from './handoff-routing'

describe('rankHandoffCandidates', () => {
  it('prefers presence before workload', () => {
    const ranked = rankHandoffCandidates([
      { userId: 'offline-idle', presenceRank: 2, openCount: 0, memberPriority: 1 },
      { userId: 'online-busy', presenceRank: 0, openCount: 7, memberPriority: 100 },
      { userId: 'away-free', presenceRank: 1, openCount: 0, memberPriority: 1 },
    ])
    expect(ranked.map((item) => item.userId)).toEqual([
      'online-busy',
      'away-free',
      'offline-idle',
    ])
  })

  it('balances open conversations between equally present specialists', () => {
    const ranked = rankHandoffCandidates([
      { userId: 'busy', presenceRank: 0, openCount: 5, memberPriority: 1 },
      { userId: 'free', presenceRank: 0, openCount: 1, memberPriority: 100 },
    ])
    expect(ranked[0]?.userId).toBe('free')
  })

  it('uses configured member priority only after presence and workload', () => {
    const ranked = rankHandoffCandidates([
      { userId: 'secondary', presenceRank: 0, openCount: 1, memberPriority: 200 },
      { userId: 'primary', presenceRank: 0, openCount: 1, memberPriority: 10 },
    ])
    expect(ranked[0]?.userId).toBe('primary')
  })

  it('does not mutate the source candidate array', () => {
    const source = [
      { userId: 'b', presenceRank: 0, openCount: 0, memberPriority: 100 },
      { userId: 'a', presenceRank: 0, openCount: 0, memberPriority: 100 },
    ]
    rankHandoffCandidates(source)
    expect(source.map((item) => item.userId)).toEqual(['b', 'a'])
  })
})

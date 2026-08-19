export interface AutomationAssigneeCandidate {
  userId: string
  openCount: number
}

/**
 * Deterministic least-loaded ranking for automation assignment.
 * Eligibility (same account + operational role) is enforced by the caller
 * before candidates reach this helper.
 */
export function rankAutomationAssignees(
  candidates: readonly AutomationAssigneeCandidate[],
): AutomationAssigneeCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.openCount !== b.openCount) return a.openCount - b.openCount
    return a.userId.localeCompare(b.userId)
  })
}

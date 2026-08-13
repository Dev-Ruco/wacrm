import { describe, expect, it } from 'vitest'
import type { GuardrailViolation } from './guardrails'

const ALL_VIOLATIONS: GuardrailViolation[] = [
  'control_marker',
  'system_prompt_leak',
  'credential_or_secret',
  'payment_card',
  'unsupported_price',
  'unverified_availability',
  'unsafe_promise',
  'history_annotation_leak',
]

const TRACE_ALLOWED_VIOLATIONS = new Set<GuardrailViolation>([
  'control_marker',
  'system_prompt_leak',
  'credential_or_secret',
  'payment_card',
  'unsupported_price',
  'unverified_availability',
  'unsafe_promise',
  'history_annotation_leak',
])

describe('agent trace guardrail violation schema contract', () => {
  it('keeps every runtime violation represented in the trace allow-list contract', () => {
    expect(Array.from(TRACE_ALLOWED_VIOLATIONS).sort()).toEqual(
      [...ALL_VIOLATIONS].sort(),
    )
  })
})

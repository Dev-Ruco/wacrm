-- Keep the persisted trace schema aligned with the runtime's GuardrailViolation union.
-- Forward-only: the original guardrail migration may already be applied in production.

alter table wacrm.agent_traces
  drop constraint if exists agent_traces_guardrail_violations_check;

alter table wacrm.agent_traces
  add constraint agent_traces_guardrail_violations_check
  check (
    guardrail_violations <@ array[
      'control_marker',
      'system_prompt_leak',
      'credential_or_secret',
      'payment_card',
      'unsupported_price',
      'unverified_availability',
      'unsafe_promise',
      'history_annotation_leak'
    ]::text[]
  );

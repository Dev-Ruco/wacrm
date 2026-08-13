import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260813213000_agent_live_observability.sql',
  ),
  'utf8',
)

describe('live observability schema', () => {
  it('keeps step reads tenant-scoped behind RLS', () => {
    expect(migration).toContain(
      'alter table wacrm.agent_trace_steps enable row level security',
    )
    expect(migration).toContain('create policy agent_trace_steps_select')
    expect(migration).toContain('wacrm.is_account_member(account_id)')
    expect(migration).toContain(
      'revoke all on table wacrm.agent_trace_steps from public, anon',
    )
  })

  it('uses agent_traces as the run parent instead of adding a parallel agent_runs table', () => {
    expect(migration).toContain('alter table wacrm.agent_traces')
    expect(migration).toContain('references wacrm.agent_traces(id) on delete cascade')
    expect(migration).not.toContain('create table if not exists wacrm.agent_runs')
  })

  it('publishes only the real run and step tables needed by Realtime', () => {
    expect(migration).toContain("tablename = 'agent_traces'")
    expect(migration).toContain("tablename = 'agent_trace_steps'")
    expect(migration).toContain('alter publication supabase_realtime add table wacrm.agent_trace_steps')
  })
})

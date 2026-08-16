// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number;
  previous: number;
}

export interface MetricsBundle {
  activeConversations: MetricDelta;
  newContactsToday: MetricDelta;
  openDealsValue: number;
  openDealsCount: number;
  messagesSentToday: MetricDelta;
}

export interface ConversationsSeriesPoint {
  day: string; // YYYY-MM-DD local
  incoming: number;
  outgoing: number;
}

export interface PipelineStageSlice {
  id: string;
  name: string;
  color: string;
  dealCount: number;
  totalValue: number;
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[];
  totalValue: number;
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number;
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null;
  samples: number;
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[];
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
}

export interface PriorityCounts {
  /** Conversations with unread inbound messages — the same signal that
   *  drives the Inbox nav dot (`unread_count > 0`), reused here as
   *  "awaiting a reply" rather than re-deriving it from message pairs. */
  awaitingReply: number;
  /** `automation_logs.status = 'failed'` in the last 24h. */
  automationErrors: number;
  /** Open deals with `expected_close_date` inside the next 7 days. */
  dealsClosingSoon: number;
}

export interface AgentActivitySummary {
  /** Distinct conversations `wacrm.agent_traces` touched today. */
  conversationsToday: number;
  /** Traces where the turn ended in a handoff today. */
  handoffsToday: number;
  /** Average `total_ms` across today's completed traces, null if none yet. */
  avgLatencyMs: number | null;
  isActive: boolean;
  agentName: string | null;
}

export type ActivityKind =
  'message' | 'deal' | 'broadcast' | 'automation' | 'contact';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string;
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string;
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string;
}

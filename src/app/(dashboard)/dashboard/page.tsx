'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { MessageSquare, UserPlus, DollarSign, Send } from 'lucide-react';
import {
  loadActivity,
  loadAgentActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadPriorities,
  loadResponseTime,
} from '@/lib/dashboard/queries';
import type {
  ActivityItem,
  AgentActivitySummary,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PriorityCounts,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { PriorityChips } from '@/components/dashboard/priority-chips';
import { AgentActivityCard } from '@/components/dashboard/agent-activity-card';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { PipelineDonut } from '@/components/dashboard/pipeline-donut';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { OnboardingGuide } from '@/components/dashboard/onboarding-guide';
import { useTranslations } from 'next-intl';

type RangeDays = 7 | 30 | 90;

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page');
  const { defaultCurrency } = useAuth();
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [priorities, setPriorities] = useState<PriorityCounts | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivitySummary | null>(null);
  const [agentActivityLoading, setAgentActivityLoading] = useState(true);
  const [range, setRange] = useState<RangeDays>(30);
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  });
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null);
  const [responseTimeLoading, setResponseTimeLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();
    void loadMetrics(db)
      .then(setMetrics)
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false));
    void loadPriorities(db)
      .then(setPriorities)
      .catch((err) => console.error('[dashboard] priorities failed:', err));
    void loadAgentActivity(db)
      .then(setAgentActivity)
      .catch((err) => console.error('[dashboard] agent activity failed:', err))
      .finally(() => setAgentActivityLoading(false));
    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false));
    void loadPipelineDonut(db)
      .then(setPipeline)
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false));
    void loadResponseTime(db)
      .then(setResponseTime)
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false));
    void loadActivity(db, 50)
      .then(setActivity)
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRangeChange = useCallback(
    (nextRange: RangeDays) => {
      setRange(nextRange);
      if (series[nextRange] !== null) return;
      setSeriesLoading(true);
      const db = createClient();
      loadConversationsSeries(db, nextRange)
        .then((nextSeries) =>
          setSeries((prev) => ({ ...prev, [nextRange]: nextSeries }))
        )
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false));
    },
    [series]
  );

  return (
    <div className="wacrm-page space-y-5">
      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">WACRM</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground sm:text-[30px]">
            {t('title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
      </header>

      <OnboardingGuide />

      <PriorityChips counts={priorities} />

      <section aria-label="Indicadores principais" className="wacrm-kpi-grid">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="wacrm-surface overflow-hidden">
              <SkeletonCard />
            </div>
          ))
        ) : (
          <>
            <div className="wacrm-surface overflow-hidden">
              <MetricCard
                title={t('activeConversations')}
                value={metrics.activeConversations.current.toLocaleString()}
                icon={MessageSquare}
                delta={{
                  sign: metrics.activeConversations.previous,
                  label: deltaLabel(
                    metrics.activeConversations.previous,
                    t('newTodayVsYesterday'),
                    t('noChange', { suffix: t('newTodayVsYesterday') })
                  ),
                }}
              />
            </div>
            <div className="wacrm-surface overflow-hidden">
              <MetricCard
                title={t('newContactsToday')}
                value={metrics.newContactsToday.current.toLocaleString()}
                icon={UserPlus}
                delta={{
                  sign: metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  label: deltaLabel(
                    metrics.newContactsToday.current - metrics.newContactsToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
            </div>
            <div className="wacrm-surface overflow-hidden">
              <MetricCard
                title={t('openDealsValue')}
                value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
                icon={DollarSign}
                subtitle={t('openDeals', { count: metrics.openDealsCount })}
              />
            </div>
            <div className="wacrm-surface overflow-hidden">
              <MetricCard
                title={t('messagesSentToday')}
                value={metrics.messagesSentToday.current.toLocaleString()}
                icon={Send}
                delta={{
                  sign: metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  label: deltaLabel(
                    metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
            </div>
          </>
        )}
      </section>

      <div className="wacrm-section-grid">
        <div className="min-w-0">
          <QuickActions />
        </div>
        <div className="min-w-0">
          <AgentActivityCard data={agentActivity} loading={agentActivityLoading} />
        </div>
      </div>

      <div className="wacrm-section-grid">
        <div className="min-w-0">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="min-w-0">
          <PipelineDonut data={pipeline} loading={pipelineLoading} currency={defaultCurrency} />
        </div>
      </div>

      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  );
}

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toLocaleString()} ${suffix}`;
}

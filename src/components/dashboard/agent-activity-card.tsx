import Link from 'next/link';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentActivitySummary } from '@/lib/dashboard/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { EmptyState } from '@/components/dashboard/empty-state';

export function AgentActivityCard({
  data,
  loading,
}: {
  data: AgentActivitySummary | null;
  loading: boolean;
}) {
  if (loading) return <SkeletonCard />;

  if (!data || (!data.isActive && data.conversationsToday === 0)) {
    return (
      <Card elevated>
        <CardHeader>
          <CardTitle as="h3" className="text-base">
            Agente IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Bot}
            title="Nenhum agente configurado"
            hint="Configura o agente de IA para veres a actividade aqui."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card elevated>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle as="h3" className="text-base">
          Agente IA
        </CardTitle>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            data.isActive
              ? 'bg-primary-soft text-primary'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {data.isActive ? 'Activo' : 'Pausado'}
        </span>
      </CardHeader>
      <CardContent>
        <Link
          href="/agents"
          className="hover:bg-muted -m-1 mb-4 flex items-center gap-3 rounded-lg p-1 transition-colors"
        >
          <div className="bg-primary-soft text-primary relative flex size-10 shrink-0 items-center justify-center rounded-full">
            <Bot className="size-5" />
            <span
              className={cn(
                'border-card absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2',
                data.isActive ? 'bg-primary' : 'bg-muted-foreground'
              )}
            />
          </div>
          <div className="text-card-title">
            {data.agentName || 'Agente sem nome'}
          </div>
        </Link>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={data.conversationsToday} label="Conversas hoje" />
          <Stat value={data.handoffsToday} label="Handoffs" />
          <Stat
            value={
              data.avgLatencyMs != null
                ? `${(data.avgLatencyMs / 1000).toFixed(1)}s`
                : '—'
            }
            label="Latência média"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="text-foreground text-lg font-bold tabular-nums">
        {value}
      </div>
      <div className="text-meta mt-0.5">{label}</div>
    </div>
  );
}

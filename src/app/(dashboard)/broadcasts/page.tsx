'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, Loader2, Send, CheckCheck, Eye } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';

const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.page');
  const tStatus = useTranslations('Broadcasts.status');
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((broadcast) => broadcast.status === 'sending'),
    [broadcasts]
  );

  const summary = useMemo(() => {
    const recipients = broadcasts.reduce((sum, item) => sum + item.total_recipients, 0);
    const delivered = broadcasts.reduce((sum, item) => sum + item.delivered_count, 0);
    const read = broadcasts.reduce((sum, item) => sum + item.read_count, 0);
    return {
      campaigns: broadcasts.length,
      recipients,
      deliveredRate: percent(delivered, recipients),
      readRate: percent(read, recipients),
    };
  }, [broadcasts]);

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') stopPolling();
      else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') startPolling();
    else stopPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="wacrm-page space-y-5">
      {anySending ? (
        <div
          role="progressbar"
          aria-label="Broadcast in progress"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            @keyframes broadcast-slide {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
          `}</style>
        </div>
      ) : null}

      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">Vendas</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create broadcasts"
          onClick={() => router.push('/broadcasts/new')}
          size="sm"
        >
          <Plus className="h-4 w-4" />
          {t('newBroadcast')}
        </GatedButton>
      </header>

      <section className="wacrm-kpi-grid">
        <CampaignMetric label="Campanhas" value={summary.campaigns.toLocaleString()} icon={Radio} />
        <CampaignMetric label="Destinatários" value={summary.recipients.toLocaleString()} icon={Send} />
        <CampaignMetric label="Taxa de entrega" value={`${summary.deliveredRate}%`} icon={CheckCheck} />
        <CampaignMetric label="Taxa de leitura" value={`${summary.readRate}%`} icon={Eye} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-section-title">Campanhas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe envios, entrega, leitura e estado de cada campanha.
          </p>
        </div>

        {broadcasts.length === 0 ? (
          <div className="wacrm-surface flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Radio className="size-5" />
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">{t('noBroadcastsYet')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('createFirst')}</p>
            <GatedButton
              canAct={canCreate}
              gateReason="create broadcasts"
              onClick={() => router.push('/broadcasts/new')}
              size="sm"
              className="mt-4"
            >
              <Plus className="h-4 w-4" />
              {t('newBroadcast')}
            </GatedButton>
          </div>
        ) : (
          <div className="wacrm-surface overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('table.template')}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t('table.recipients')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('table.delivery')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('table.read')}</TableHead>
                  <TableHead>{t('table.status')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('table.date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {broadcasts.map((broadcast) => {
                  const status = getBroadcastStatus(broadcast.status);
                  return (
                    <TableRow
                      key={broadcast.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">{broadcast.name}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {broadcast.template_name}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                        {broadcast.total_recipients}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <RateCell value={broadcast.delivered_count} total={broadcast.total_recipients} color="bg-primary" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <RateCell value={broadcast.read_count} total={broadcast.total_recipients} color="bg-sky-500" />
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}>
                          {status.pulse ? (
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                            </span>
                          ) : null}
                          {tStatus(status.label)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {new Date(broadcast.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function CampaignMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Radio;
}) {
  return (
    <div className="wacrm-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-meta">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  );
}

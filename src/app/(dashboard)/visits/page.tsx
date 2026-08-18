'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';

interface Visit {
  id: string;
  scheduled_at: string;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  contact: { id: string; name: string | null; phone: string } | null;
}

const STATUS_META: Record<
  Visit['status'],
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  scheduled: { label: 'Marcada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'outline' },
  cancelled: { label: 'Cancelada', variant: 'outline' },
  no_show: { label: 'Não compareceu', variant: 'destructive' },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function VisitsPage() {
  const canManage = useCan('edit-settings');
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/scheduled-visits', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? 'Não foi possível carregar as visitas.');
      }
      setVisits(data.visits ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível carregar as visitas.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (
    id: string,
    status: 'completed' | 'cancelled' | 'no_show'
  ) => {
    setActing(id);
    try {
      const response = await fetch(`/api/scheduled-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? 'Não foi possível actualizar a visita.');
      }
      setVisits(
        (current) =>
          current?.map((visit) => (visit.id === id ? { ...visit, status } : visit)) ?? null
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível actualizar a visita.'
      );
    } finally {
      setActing(null);
    }
  };

  const upcoming = (visits ?? []).filter((visit) => visit.status === 'scheduled');
  const past = (visits ?? []).filter((visit) => visit.status !== 'scheduled');

  return (
    <div className="space-y-5">
      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">CRM</p>
          <div className="mt-1 flex items-center gap-2.5">
            <CalendarClock className="size-5 text-primary" />
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
              Visitas agendadas
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Visitas à loja marcadas pelo agente de IA ou pela equipa.
          </p>
        </div>
      </header>

      <section className="wacrm-kpi-grid">
        <VisitMetric label="Por vir" value={upcoming.length} />
        <VisitMetric label="Histórico" value={past.length} />
        <VisitMetric
          label="Concluídas"
          value={past.filter((visit) => visit.status === 'completed').length}
        />
        <VisitMetric
          label="Canceladas / faltas"
          value={past.filter((visit) => visit.status !== 'completed').length}
        />
      </section>

      {loading ? (
        <div className="wacrm-surface flex min-h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-3">
              <h2 className="text-section-title">Próximas visitas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Compromissos que ainda precisam de atendimento ou confirmação.
              </p>
            </div>
            {upcoming.length === 0 ? (
              <div className="wacrm-surface border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhuma visita marcada ainda.
              </div>
            ) : (
              <div className="wacrm-surface overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Cliente</TableHead>
                      <TableHead>Data e hora</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead>Estado</TableHead>
                      {canManage ? <TableHead className="text-right">Acções</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell>
                          <p className="font-medium text-foreground">
                            {visit.contact?.name || 'Sem nome'}
                          </p>
                          <p className="text-xs text-muted-foreground">{visit.contact?.phone}</p>
                        </TableCell>
                        <TableCell>{DATE_FORMATTER.format(new Date(visit.scheduled_at))}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {visit.notes || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_META[visit.status].variant}>
                            {STATUS_META[visit.status].label}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={acting === visit.id}
                                onClick={() => void setStatus(visit.id, 'completed')}
                              >
                                <Check className="size-3.5" /> Concluída
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={acting === visit.id}
                                onClick={() => void setStatus(visit.id, 'cancelled')}
                              >
                                <X className="size-3.5" /> Cancelar
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {past.length > 0 ? (
            <section>
              <div className="mb-3">
                <h2 className="text-section-title">Histórico</h2>
              </div>
              <div className="wacrm-surface overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Cliente</TableHead>
                      <TableHead>Data e hora</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {past.map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell>
                          <p className="text-foreground">{visit.contact?.name || 'Sem nome'}</p>
                          <p className="text-xs text-muted-foreground">{visit.contact?.phone}</p>
                        </TableCell>
                        <TableCell>{DATE_FORMATTER.format(new Date(visit.scheduled_at))}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_META[visit.status].variant}>
                            {STATUS_META[visit.status].label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function VisitMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="wacrm-surface p-4 sm:p-5">
      <p className="text-meta">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ImageOff,
  Loader2,
  RefreshCw,
  SearchCheck,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';

type Severity = 'info' | 'warning' | 'critical';

type HealthIssue = {
  issueType: string;
  severity: Severity;
  title: string;
  description: string;
  productId: string | null;
  sourceId: string | null;
};

type Health = {
  score: number;
  totalProducts: number;
  activeProducts: number;
  productsWithMedia: number;
  productsWithOfferingType: number;
  missingRequiredAttributeCount: number;
  failedMirrorSourceCount: number;
  issues: HealthIssue[];
};

type StewardSuggestion = {
  id: string;
  product_id: string | null;
  source_id: string | null;
  issue_type: string;
  severity: Severity;
  title: string;
  description: string | null;
  proposed_changes: Record<string, unknown>;
  evidence: Record<string, unknown>;
  confidence: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  created_by: 'system' | 'ai' | 'import';
  created_at: string;
};

function readiness(score: number) {
  if (score >= 90) return { label: 'Pronto para atendimento', detail: 'A estrutura principal está saudável.' };
  if (score >= 75) return { label: 'Bom, com melhorias', detail: 'O agente pode trabalhar, mas há pontos a melhorar.' };
  if (score >= 50) return { label: 'Precisa de atenção', detail: 'Há lacunas que podem afectar as respostas comerciais.' };
  return { label: 'Baixa prontidão', detail: 'Corrija os bloqueios antes de depender do catálogo no atendimento.' };
}

function severityLabel(severity: Severity) {
  if (severity === 'critical') return 'Crítico';
  if (severity === 'warning') return 'Atenção';
  return 'Informação';
}

function originLabel(origin: StewardSuggestion['created_by']) {
  if (origin === 'ai') return 'IA';
  if (origin === 'import') return 'Importação';
  return 'Auditoria automática';
}

export function CatalogAgentPanel({ onOpenOffers }: { onOpenOffers: () => void }) {
  const canEdit = useCan('edit-settings');
  const [health, setHealth] = useState<Health | null>(null);
  const [suggestions, setSuggestions] = useState<StewardSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [healthResponse, suggestionsResponse] = await Promise.all([
        fetch('/api/catalog/health', { cache: 'no-store' }),
        fetch('/api/catalog/steward?status=pending', { cache: 'no-store' }),
      ]);
      const healthBody = await healthResponse.json().catch(() => ({}));
      const suggestionsBody = await suggestionsResponse.json().catch(() => ({}));
      if (!healthResponse.ok) {
        throw new Error(healthBody.error ?? 'Não foi possível avaliar o catálogo.');
      }
      if (!suggestionsResponse.ok) {
        throw new Error(suggestionsBody.error ?? 'Não foi possível carregar as sugestões.');
      }
      setHealth(healthBody.health ?? null);
      setSuggestions(suggestionsBody.suggestions ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar o agente do catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const issues = health?.issues ?? [];
    return {
      critical: issues.filter((issue) => issue.severity === 'critical').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
      info: issues.filter((issue) => issue.severity === 'info').length,
    };
  }, [health]);

  async function runScan() {
    if (!canEdit || scanning) return;
    setScanning(true);
    try {
      const response = await fetch('/api/catalog/health', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível analisar o catálogo.');
      await load();
      toast.success(`Análise concluída: ${body.queued ?? 0} ponto(s) para revisão.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao analisar o catálogo.');
    } finally {
      setScanning(false);
    }
  }

  async function reviewSuggestion(id: string, status: 'approved' | 'rejected') {
    if (!canEdit || reviewingId) return;
    setReviewingId(id);
    try {
      const response = await fetch('/api/catalog/steward', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível actualizar a sugestão.');
      setSuggestions((current) => current.filter((suggestion) => suggestion.id !== id));
      toast.success(status === 'approved' ? 'Ponto marcado como resolvido.' : 'Sugestão ignorada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao actualizar a sugestão.');
    } finally {
      setReviewingId(null);
    }
  }

  if (loading && !health) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        A preparar o Agente do Catálogo…
      </div>
    );
  }

  if (!health) return null;

  const state = readiness(health.score);
  const topIssues = health.issues.slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="border-border overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
          <div className="border-border p-5 lg:border-r">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="text-primary size-5" />
                  <h2 className="text-section-title">Prontidão para atendimento</h2>
                </div>
                <p className="text-muted-foreground mt-1 max-w-xl text-sm">
                  O Agente do Catálogo verifica se as ofertas estão organizadas e suficientemente completas para apoiar o agente conversacional.
                </p>
              </div>
              <span className="text-primary text-3xl font-semibold tabular-nums">{health.score}%</span>
            </div>

            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${health.score}%` }} />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">{state.label}</p>
            <p className="text-muted-foreground mt-1 text-xs">{state.detail}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => void runScan()} disabled={!canEdit || scanning}>
                {scanning ? <Loader2 className="animate-spin" /> : <SearchCheck />}
                Analisar catálogo
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading || scanning}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Actualizar
              </Button>
            </div>
            {!canEdit ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Apenas administradores podem executar uma nova análise e rever sugestões.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 lg:grid-cols-2">
            <Metric label="Ofertas activas" value={health.activeProducts} />
            <Metric label="Sem imagem" value={Math.max(0, health.activeProducts - health.productsWithMedia)} icon={ImageOff} />
            <Metric label="Atributos em falta" value={health.missingRequiredAttributeCount} icon={Tags} />
            <Metric label="Fontes com problema" value={health.failedMirrorSourceCount} icon={Database} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="border-border rounded-xl border bg-card">
          <div className="border-border/80 border-b px-4 py-3.5">
            <h2 className="text-card-title">Precisa da sua atenção</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {counts.critical} crítico(s), {counts.warning} aviso(s) e {counts.info} melhoria(s) informativa(s).
            </p>
          </div>
          {topIssues.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CheckCircle2 className="text-primary mx-auto size-6" />
              <p className="mt-2 text-sm font-medium text-foreground">Nenhum bloqueio detectado</p>
              <p className="text-muted-foreground mt-1 text-xs">A estrutura actual passou pelas verificações disponíveis.</p>
            </div>
          ) : (
            <div className="divide-border divide-y">
              {topIssues.map((issue, index) => (
                <div key={`${issue.issueType}:${issue.productId ?? issue.sourceId ?? index}`} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        issue.severity === 'critical'
                          ? 'text-destructive'
                          : issue.severity === 'warning'
                            ? 'text-amber-500'
                            : 'text-muted-foreground'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{issue.title}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{issue.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {health.issues.length > 5 ? (
            <div className="border-border/80 border-t px-4 py-2.5">
              <p className="text-muted-foreground text-xs">Mais {health.issues.length - 5} ponto(s) aparecem na fila de sugestões.</p>
            </div>
          ) : null}
        </div>

        <div className="border-border rounded-xl border bg-card">
          <div className="border-border/80 flex items-start justify-between gap-3 border-b px-4 py-3.5">
            <div>
              <h2 className="text-card-title">Sugestões do Agente do Catálogo</h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                O sistema propõe melhorias; factos comerciais sensíveis continuam sob controlo humano.
              </p>
            </div>
            <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
              {suggestions.length}
            </span>
          </div>

          {suggestions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Sparkles className="text-primary mx-auto size-6" />
              <p className="mt-2 text-sm font-medium text-foreground">Sem sugestões pendentes</p>
              <p className="text-muted-foreground mt-1 text-xs">Execute uma análise quando alterar ou importar ofertas.</p>
            </div>
          ) : (
            <div className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {suggestions.map((suggestion) => {
                const busy = reviewingId === suggestion.id;
                return (
                  <div key={suggestion.id} className="px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 size-2 shrink-0 rounded-full',
                          suggestion.severity === 'critical'
                            ? 'bg-destructive'
                            : suggestion.severity === 'warning'
                              ? 'bg-amber-500'
                              : 'bg-muted-foreground/60'
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold text-foreground">{suggestion.title}</p>
                          <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                            {severityLabel(suggestion.severity)} · {originLabel(suggestion.created_by)}
                          </span>
                        </div>
                        {suggestion.description ? (
                          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{suggestion.description}</p>
                        ) : null}
                        {canEdit ? (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void reviewSuggestion(suggestion.id, 'approved')}
                              disabled={Boolean(reviewingId)}
                            >
                              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                              Marcar resolvido
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void reviewSuggestion(suggestion.id, 'rejected')}
                              disabled={Boolean(reviewingId)}
                            >
                              <X />
                              Ignorar
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="border-border rounded-xl border bg-card px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-card-title">O que o Agente do Catálogo prepara para o atendimento</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Organização das ofertas, atributos pesquisáveis, categorias/aliases, qualidade das fontes e relações usadas pelas ferramentas do agente principal.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenOffers}>
            Ver ofertas
          </Button>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon?: typeof ImageOff;
}) {
  return (
    <div className="min-h-28 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

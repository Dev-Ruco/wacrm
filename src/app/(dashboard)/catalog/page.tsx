'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Boxes,
  Database,
  GitBranch,
  Layers3,
  Loader2,
  PackageSearch,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CatalogAgentPanel } from '@/components/catalog/catalog-agent-panel';
import {
  CatalogWorkspaceNav,
  type CatalogWorkspaceKey,
} from '@/components/catalog/catalog-workspace-nav';
import { CompositionManagerPanel } from '@/components/catalog/composition-manager-panel';
import {
  ExternalIntegrationsTab,
  type Source,
} from '@/components/catalog/external-integrations-tab';
import { OfferingSchemaManager } from '@/components/catalog/offering-schema-manager';
import { ProductsTab } from '@/components/catalog/products-tab';
import { TaxonomyManager } from '@/components/catalog/taxonomy-manager';
import type { Product } from '@/components/catalog/product-card';
import { cn } from '@/lib/utils';

type DatabaseStats = {
  totalProductRecords: number;
  totalVariantRecords: number;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    ok: boolean;
    productRecords: number;
    variantRecords: number;
    tables: Array<{ table: string; kind: string; count: number }>;
    error?: string;
  }>;
};

type HealthSummary = {
  score: number;
  activeProducts: number;
  issues: Array<{ severity: 'info' | 'warning' | 'critical' }>;
};

type CatalogView =
  | 'overview'
  | 'products'
  | 'steward'
  | 'external'
  | 'offerings'
  | 'compositions'
  | 'taxonomy';

type RequestedCatalogView = CatalogView | 'health';

const VIEW_META: Record<
  CatalogView,
  { label: string; description: string; icon: typeof PackageSearch }
> = {
  overview: {
    label: 'Catálogo',
    description: 'Veja se o conhecimento comercial está pronto para apoiar o atendimento.',
    icon: PackageSearch,
  },
  products: {
    label: 'Ofertas',
    description: 'Produtos, serviços e outras ofertas que o agente pode pesquisar e apresentar.',
    icon: Boxes,
  },
  steward: {
    label: 'Agente do Catálogo',
    description: 'Analisa qualidade, detecta lacunas e organiza sugestões de melhoria para o catálogo.',
    icon: Sparkles,
  },
  external: {
    label: 'Fontes',
    description: 'Ligue bases de dados e outras origens que alimentam o catálogo canónico.',
    icon: Database,
  },
  offerings: {
    label: 'Estrutura da oferta',
    description: 'Configuração avançada de tipos e atributos pesquisáveis por negócio.',
    icon: Layers3,
  },
  compositions: {
    label: 'Composições',
    description: 'Relações e combinações estruturadas entre ofertas.',
    icon: GitBranch,
  },
  taxonomy: {
    label: 'Categorias e aliases',
    description: 'Vocabulário próprio da empresa para categorias, cores e termos equivalentes.',
    icon: SlidersHorizontal,
  },
};

function isRequestedCatalogView(value: string | null): value is RequestedCatalogView {
  return Boolean(
    value &&
      [
        'overview',
        'products',
        'steward',
        'external',
        'offerings',
        'compositions',
        'taxonomy',
        'health',
      ].includes(value)
  );
}

function workspaceKey(view: CatalogView): CatalogWorkspaceKey {
  if (view === 'products') return 'offers';
  if (view === 'steward') return 'steward';
  if (view === 'external') return 'sources';
  if (view === 'offerings') return 'structure';
  if (view === 'taxonomy') return 'taxonomy';
  if (view === 'compositions') return 'compositions';
  return 'overview';
}

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      }
    >
      <CatalogPageInner />
    </Suspense>
  );
}

function CatalogPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const parsedView: RequestedCatalogView = isRequestedCatalogView(requestedView)
    ? requestedView
    : 'overview';
  const activeView: CatalogView = parsedView === 'health' ? 'steward' : parsedView;

  const [products, setProducts] = useState<Product[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats>({
    totalProductRecords: 0,
    totalVariantRecords: 0,
    sources: [],
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [productsResponse, sourcesResponse, statsResponse, healthResponse] =
        await Promise.all([
          fetch('/api/catalog/products', { cache: 'no-store' }),
          fetch('/api/catalog/sources', { cache: 'no-store' }),
          fetch('/api/catalog/sources/stats', { cache: 'no-store' }),
          fetch('/api/catalog/health', { cache: 'no-store' }),
        ]);

      const productsBody = await productsResponse.json().catch(() => ({}));
      const sourcesBody = await sourcesResponse.json().catch(() => ({}));
      const statsBody = await statsResponse.json().catch(() => ({}));
      const healthBody = await healthResponse.json().catch(() => ({}));

      if (!productsResponse.ok) {
        throw new Error(productsBody.error ?? 'Não foi possível carregar as ofertas.');
      }
      if (!sourcesResponse.ok && sourcesResponse.status !== 403) {
        throw new Error(sourcesBody.error ?? 'Não foi possível carregar as fontes.');
      }

      setProducts(productsBody.products ?? []);
      setSources(sourcesBody.sources ?? []);
      setHealth(healthResponse.ok ? (healthBody.health ?? null) : null);

      if (statsResponse.ok) {
        setDatabaseStats({
          totalProductRecords: statsBody.totalProductRecords ?? 0,
          totalVariantRecords: statsBody.totalVariantRecords ?? 0,
          sources: statsBody.sources ?? [],
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao carregar o catálogo.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeProducts = useMemo(
    () => products.filter((product) => product.is_active),
    [products]
  );

  function selectView(view: CatalogView) {
    router.replace(`/catalog?view=${view}`, { scroll: false });
  }

  const meta = VIEW_META[activeView];
  const HeaderIcon = meta.icon;

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
      <CatalogWorkspaceNav active={workspaceKey(activeView)} />

      <main className="min-w-0 flex-1 lg:pl-6">
        <header className="border-border/80 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <HeaderIcon className="text-primary size-5" />
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">
                {meta.label}
              </h1>
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              {meta.description}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualizar
          </Button>
        </header>

        <div className="pt-5">
          {activeView === 'overview' ? (
            <CatalogOverview
              loading={loading}
              activeProducts={activeProducts.length}
              health={health}
              databaseStats={databaseStats}
              externalSourceCount={sources.length}
              onNavigate={selectView}
            />
          ) : null}

          {activeView === 'products' ? (
            <ProductsTab products={products} setProducts={setProducts} />
          ) : null}

          {activeView === 'steward' ? (
            <CatalogAgentPanel onOpenOffers={() => selectView('products')} />
          ) : null}

          {activeView === 'external' ? (
            <ExternalIntegrationsTab sources={sources} setSources={setSources} />
          ) : null}

          {activeView === 'offerings' ? (
            <OfferingSchemaManager products={products} />
          ) : null}

          {activeView === 'compositions' ? (
            <CompositionManagerPanel products={products} />
          ) : null}

          {activeView === 'taxonomy' ? <TaxonomyManager /> : null}
        </div>
      </main>
    </div>
  );
}

function CatalogOverview({
  loading,
  activeProducts,
  health,
  databaseStats,
  externalSourceCount,
  onNavigate,
}: {
  loading: boolean;
  activeProducts: number;
  health: HealthSummary | null;
  databaseStats: DatabaseStats;
  externalSourceCount: number;
  onNavigate: (view: CatalogView) => void;
}) {
  const critical = health?.issues.filter((issue) => issue.severity === 'critical').length ?? 0;
  const warnings = health?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;
  const needsAttention = critical + warnings;

  return (
    <div className="space-y-6">
      <section className="border-border overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
          <div className="border-border p-5 lg:border-r">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-meta">Prontidão para atendimento</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {health
                    ? health.score >= 90
                      ? 'Catálogo pronto'
                      : health.score >= 75
                        ? 'Bom, com melhorias'
                        : 'Precisa de atenção'
                    : 'A avaliar catálogo'}
                </h2>
                <p className="text-muted-foreground mt-1 max-w-lg text-sm">
                  A prioridade é garantir que o agente principal encontra ofertas e factos comerciais confiáveis sem o cliente ter de configurar a arquitectura por baixo.
                </p>
              </div>
              <span className="text-primary text-3xl font-semibold tabular-nums">
                {health ? `${health.score}%` : '—'}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => onNavigate('steward')}>
                <Sparkles />
                Abrir Agente do Catálogo
              </Button>
              <Button variant="outline" onClick={() => onNavigate('products')}>
                Ver ofertas
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-border">
            <OverviewMetric label="Ofertas activas" value={activeProducts} />
            <OverviewMetric label="Pontos a corrigir" value={loading ? '—' : needsAttention} />
            <OverviewMetric label="Fontes ligadas" value={externalSourceCount} />
            <OverviewMetric
              label="Registos externos"
              value={loading ? '—' : databaseStats.totalProductRecords}
            />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-section-title">Começar por aqui</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            O fluxo normal deve ser simples: fornecer as ofertas, deixar o sistema analisar e rever apenas o que precisa de decisão humana.
          </p>
        </div>

        <div className="border-border grid overflow-hidden rounded-xl border bg-card md:grid-cols-3 md:divide-x md:divide-border">
          <QuickStep
            number="1"
            title="Adicionar ou importar ofertas"
            description="Produtos, serviços ou outras ofertas comerciais."
            onClick={() => onNavigate('products')}
          />
          <QuickStep
            number="2"
            title="Deixar o agente analisar"
            description="Detecta lacunas, qualidade e pontos que podem afectar o atendimento."
            onClick={() => onNavigate('steward')}
          />
          <QuickStep
            number="3"
            title="Ligar uma fonte, se necessário"
            description="Use base de dados externa quando o negócio já possui uma origem oficial."
            onClick={() => onNavigate('external')}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-section-title">Fontes de dados</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Estado das integrações que alimentam o catálogo canónico.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('external')}>
            Gerir fontes
          </Button>
        </div>

        <div className="border-border overflow-hidden rounded-xl border bg-card">
          {databaseStats.sources.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Database className="text-muted-foreground mx-auto size-6" />
              <p className="text-foreground mt-3 text-sm font-medium">
                Nenhuma fonte externa ligada
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Isto não é um erro. Um negócio pode trabalhar apenas com as ofertas guardadas no WACRM.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-muted/35 text-muted-foreground">
                  <tr className="border-border border-b text-left text-xs">
                    <th className="px-4 py-2.5 font-medium">Fonte</th>
                    <th className="px-4 py-2.5 font-medium">Ofertas</th>
                    <th className="px-4 py-2.5 font-medium">Variantes</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {databaseStats.sources.map((stat) => (
                    <tr
                      key={stat.sourceId}
                      className="border-border/80 border-b last:border-b-0"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{stat.sourceName}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {stat.ok ? stat.productRecords : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {stat.ok ? stat.variantRecords : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 text-xs font-medium',
                            stat.ok ? 'text-primary' : 'text-destructive'
                          )}
                        >
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              stat.ok ? 'bg-primary' : 'bg-destructive'
                            )}
                          />
                          {stat.ok ? 'Saudável' : 'Indisponível'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function OverviewMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-h-28 p-4">
      <p className="text-meta">{label}</p>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function QuickStep({
  number,
  title,
  description,
  onClick,
}: {
  number: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/40 flex min-h-32 items-start gap-3 px-4 py-4 text-left transition-colors"
    >
      <span className="bg-primary-soft text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">{description}</span>
      </span>
    </button>
  );
}

'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  Boxes,
  Database,
  GitBranch,
  HeartPulse,
  Layers3,
  Loader2,
  PackageSearch,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CatalogHealthPanel } from '@/components/catalog/catalog-health-panel';
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

type CatalogView =
  | 'overview'
  | 'products'
  | 'offerings'
  | 'compositions'
  | 'taxonomy'
  | 'health'
  | 'external';

const CATALOG_VIEWS: Array<{
  id: CatalogView;
  label: string;
  icon: typeof PackageSearch;
}> = [
  { id: 'overview', label: 'Visão geral', icon: Activity },
  { id: 'products', label: 'Produtos', icon: Boxes },
  { id: 'offerings', label: 'Estrutura da oferta', icon: Layers3 },
  { id: 'compositions', label: 'Composições', icon: GitBranch },
  { id: 'taxonomy', label: 'Categorias', icon: SlidersHorizontal },
  { id: 'health', label: 'Saúde do catálogo', icon: HeartPulse },
  { id: 'external', label: 'Integrações', icon: Database },
];

function isCatalogView(value: string | null): value is CatalogView {
  return CATALOG_VIEWS.some((item) => item.id === value);
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
  const activeView: CatalogView = isCatalogView(requestedView)
    ? requestedView
    : 'overview';

  const [products, setProducts] = useState<Product[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats>({
    totalProductRecords: 0,
    totalVariantRecords: 0,
    sources: [],
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        fetch('/api/catalog/products', { cache: 'no-store' }),
        fetch('/api/catalog/sources', { cache: 'no-store' }),
        fetch('/api/catalog/sources/stats', { cache: 'no-store' }),
      ]);
      const pa = await a.json().catch(() => ({}));
      const pb = await b.json().catch(() => ({}));
      const pc = await c.json().catch(() => ({}));
      if (!a.ok)
        throw new Error(pa.error ?? 'Não foi possível carregar os produtos.');
      if (!b.ok && b.status !== 403)
        throw new Error(pb.error ?? 'Não foi possível carregar as fontes.');
      setProducts(pa.products ?? []);
      setSources(pb.sources ?? []);
      if (c.ok)
        setDatabaseStats({
          totalProductRecords: pc.totalProductRecords ?? 0,
          totalVariantRecords: pc.totalVariantRecords ?? 0,
          sources: pc.sources ?? [],
        });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Erro ao carregar o catálogo.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active),
    [products]
  );
  const externalSourceCount = sources.length;

  function selectView(view: CatalogView) {
    router.replace(`/catalog?view=${view}`, { scroll: false });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
      <aside className="border-border/80 w-full shrink-0 rounded-xl border bg-card/35 p-2 lg:w-56 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:bg-transparent lg:p-0 lg:pr-4">
        <div className="mb-3 px-2 pt-1">
          <p className="text-label">Catálogo</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Oferta, dados e operação comercial
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
          {CATALOG_VIEWS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => selectView(item.id)}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-150',
                  active
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => router.push('/operations')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-150"
          >
            <Settings2 className="size-4 shrink-0" />
            <span>Operações</span>
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 lg:pl-6">
        <header className="border-border/80 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <PackageSearch className="text-primary size-5" />
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">
                {CATALOG_VIEWS.find((item) => item.id === activeView)?.label ??
                  'Catálogo'}
              </h1>
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Gerir as ofertas, a estrutura comercial e as fontes que alimentam o
              atendimento no WhatsApp.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Actualizar
          </Button>
        </header>

        <div className="pt-5">
          {activeView === 'overview' ? (
            <CatalogOverview
              loading={loading}
              activeProducts={activeProducts.length}
              databaseStats={databaseStats}
              externalSourceCount={externalSourceCount}
              onNavigate={selectView}
            />
          ) : null}
          {activeView === 'products' ? (
            <ProductsTab products={products} setProducts={setProducts} />
          ) : null}
          {activeView === 'offerings' ? (
            <OfferingSchemaManager products={products} />
          ) : null}
          {activeView === 'compositions' ? (
            <CompositionManagerPanel products={products} />
          ) : null}
          {activeView === 'taxonomy' ? <TaxonomyManager /> : null}
          {activeView === 'health' ? <CatalogHealthPanel /> : null}
          {activeView === 'external' ? (
            <ExternalIntegrationsTab
              sources={sources}
              setSources={setSources}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function CatalogOverview({
  loading,
  activeProducts,
  databaseStats,
  externalSourceCount,
  onNavigate,
}: {
  loading: boolean;
  activeProducts: number;
  databaseStats: DatabaseStats;
  externalSourceCount: number;
  onNavigate: (view: CatalogView) => void;
}) {
  const metrics = [
    { label: 'Produtos activos', value: activeProducts },
    {
      label: 'Registos externos',
      value: loading ? '—' : databaseStats.totalProductRecords,
    },
    {
      label: 'Variantes',
      value: loading ? '—' : databaseStats.totalVariantRecords,
    },
    { label: 'Fontes ligadas', value: externalSourceCount },
  ];

  return (
    <div className="space-y-6">
      <section
        aria-label="Resumo do catálogo"
        className="border-border bg-card overflow-hidden rounded-xl border"
      >
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          {metrics.map((metric) => (
            <div key={metric.label} className="px-4 py-4 sm:px-5">
              <p className="text-meta">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-section-title">Fontes de dados</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Estado das fontes que alimentam o catálogo canónico.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('external')}>
            Gerir integrações
          </Button>
        </div>

        <div className="border-border overflow-hidden rounded-xl border bg-card">
          {databaseStats.sources.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Database className="text-muted-foreground mx-auto size-6" />
              <p className="text-foreground mt-3 text-sm font-medium">
                Nenhuma fonte externa com estatísticas
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Ligue uma integração para acompanhar produtos, variantes e saúde.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-muted/35 text-muted-foreground">
                  <tr className="border-border border-b text-left text-xs">
                    <th className="px-4 py-2.5 font-medium">Fonte</th>
                    <th className="px-4 py-2.5 font-medium">Produtos</th>
                    <th className="px-4 py-2.5 font-medium">Variantes</th>
                    <th className="px-4 py-2.5 font-medium">Tabelas</th>
                    <th className="px-4 py-2.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {databaseStats.sources.map((stat) => (
                    <tr
                      key={stat.sourceId}
                      className="border-border/80 border-b last:border-b-0"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {stat.sourceName}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {stat.ok ? stat.productRecords : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {stat.ok ? stat.variantRecords : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {stat.ok ? stat.tables.length : '—'}
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
                        {!stat.ok && stat.error ? (
                          <p className="text-destructive mt-1 max-w-sm text-xs">
                            {stat.error}
                          </p>
                        ) : null}
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

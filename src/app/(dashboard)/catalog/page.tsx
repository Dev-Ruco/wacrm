'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Database,
  FolderOpen,
  GitBranch,
  Layers3,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CatalogAgentPanel } from '@/components/catalog/catalog-agent-panel';
import { CatalogCollectionsPanel } from '@/components/catalog/catalog-collections-panel';
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
import { TaxonomyManager } from '@/components/catalog/taxonomy-manager';
import type { Product } from '@/components/catalog/product-card';

type CatalogView =
  | 'overview'
  | 'steward'
  | 'external'
  | 'offerings'
  | 'compositions'
  | 'taxonomy';

type RequestedCatalogView = CatalogView | 'products' | 'health';

const VIEW_META: Record<CatalogView, { label: string; description: string; icon: typeof FolderOpen }> = {
  overview: {
    label: 'Catálogos',
    description: 'Organize linhas de produtos e ofertas em catálogos separados e fáceis de gerir.',
    icon: FolderOpen,
  },
  steward: {
    label: 'Agente do Catálogo',
    description: 'Analisa qualidade, detecta lacunas e organiza sugestões de melhoria para o conhecimento comercial.',
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

function normalizeView(value: string | null): CatalogView {
  if (value === 'health') return 'steward';
  if (value === 'products') return 'overview';
  if (
    value === 'steward' ||
    value === 'external' ||
    value === 'offerings' ||
    value === 'compositions' ||
    value === 'taxonomy'
  ) {
    return value;
  }
  return 'overview';
}

function workspaceKey(view: CatalogView): CatalogWorkspaceKey {
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
          <Loader2 className="size-6 animate-spin text-primary" />
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
  const requestedView = searchParams.get('view') as RequestedCatalogView | null;
  const activeView = normalizeView(requestedView);
  const [products, setProducts] = useState<Product[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSupportingData = useCallback(async () => {
    setLoading(true);
    try {
      const [productsResponse, sourcesResponse] = await Promise.all([
        fetch('/api/catalog/products', { cache: 'no-store' }),
        fetch('/api/catalog/sources', { cache: 'no-store' }),
      ]);
      const productsBody = await productsResponse.json().catch(() => ({}));
      const sourcesBody = await sourcesResponse.json().catch(() => ({}));
      if (!productsResponse.ok) {
        throw new Error(productsBody.error ?? 'Não foi possível carregar as ofertas.');
      }
      if (!sourcesResponse.ok && sourcesResponse.status !== 403) {
        throw new Error(sourcesBody.error ?? 'Não foi possível carregar as fontes.');
      }
      setProducts(productsBody.products ?? []);
      setSources(sourcesBody.sources ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar o catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'external' || activeView === 'offerings' || activeView === 'compositions') {
      void loadSupportingData();
    }
  }, [activeView, loadSupportingData]);

  const meta = VIEW_META[activeView];
  const HeaderIcon = meta.icon;
  const canRefresh =
    activeView === 'external' || activeView === 'offerings' || activeView === 'compositions';

  return (
    <div className="wacrm-page min-w-0 space-y-5">
      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">Vendas</p>
          <div className="mt-1 flex items-center gap-2.5">
            <HeaderIcon className="size-5 text-primary" />
            <h1 className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
              {meta.label}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {meta.description}
          </p>
        </div>
        {canRefresh ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadSupportingData()}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualizar
          </Button>
        ) : null}
      </header>

      <CatalogWorkspaceNav active={workspaceKey(activeView)} />

      <section className="min-w-0">
        {activeView === 'overview' ? <CatalogCollectionsPanel /> : null}
        {activeView === 'steward' ? (
          <CatalogAgentPanel onOpenOffers={() => router.push('/catalog')} />
        ) : null}
        {activeView === 'external' ? (
          <ExternalIntegrationsTab sources={sources} setSources={setSources} />
        ) : null}
        {activeView === 'offerings' ? <OfferingSchemaManager products={products} /> : null}
        {activeView === 'compositions' ? <CompositionManagerPanel products={products} /> : null}
        {activeView === 'taxonomy' ? <TaxonomyManager /> : null}
      </section>
    </div>
  );
}

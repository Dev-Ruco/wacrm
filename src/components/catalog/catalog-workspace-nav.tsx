'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ChevronDown,
  Database,
  FolderOpen,
  GitBranch,
  Layers3,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CatalogWorkspaceKey =
  | 'overview'
  | 'offers'
  | 'steward'
  | 'sources'
  | 'structure'
  | 'taxonomy'
  | 'compositions'
  | 'operations';

const MAIN_ITEMS: Array<{
  key: CatalogWorkspaceKey;
  label: string;
  href: string;
  icon: typeof Activity;
}> = [
  { key: 'overview', label: 'Catálogos', href: '/catalog', icon: FolderOpen },
  { key: 'steward', label: 'Agente do Catálogo', href: '/catalog?view=steward', icon: Sparkles },
  { key: 'sources', label: 'Fontes', href: '/catalog?view=external', icon: Database },
];

const ADVANCED_ITEMS: Array<{
  key: CatalogWorkspaceKey;
  label: string;
  href: string;
  icon: typeof Activity;
}> = [
  { key: 'structure', label: 'Estrutura da oferta', href: '/catalog?view=offerings', icon: Layers3 },
  { key: 'taxonomy', label: 'Categorias e aliases', href: '/catalog?view=taxonomy', icon: SlidersHorizontal },
  { key: 'compositions', label: 'Composições', href: '/catalog?view=compositions', icon: GitBranch },
  { key: 'operations', label: 'Operações', href: '/operations', icon: Settings2 },
];

export function CatalogWorkspaceNav({ active }: { active: CatalogWorkspaceKey }) {
  const activeIsAdvanced = ADVANCED_ITEMS.some((item) => item.key === active);
  const [advancedOpen, setAdvancedOpen] = useState(activeIsAdvanced);

  return (
    <aside className="border-border/80 w-full shrink-0 rounded-xl border bg-card/35 p-2 lg:sticky lg:top-0 lg:w-56 lg:self-start lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:bg-transparent lg:p-0 lg:pr-4">
      <div className="mb-3 px-2 pt-1">
        <p className="text-label">Catálogo</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          Organize o conhecimento comercial usado pelo atendimento.
        </p>
      </div>

      <nav aria-label="Navegação do catálogo" className="space-y-1">
        {MAIN_ITEMS.map((item) => (
          <CatalogNavItem key={item.key} item={item} active={active === item.key || (active === 'offers' && item.key === 'overview')} />
        ))}

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            aria-expanded={advancedOpen}
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors',
              activeIsAdvanced && 'text-foreground'
            )}
          >
            <Settings2 className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">Configuração avançada</span>
            <ChevronDown
              className={cn('size-3.5 shrink-0 transition-transform', advancedOpen && 'rotate-180')}
            />
          </button>

          {advancedOpen ? (
            <div className="mt-1 space-y-1 pl-2">
              {ADVANCED_ITEMS.map((item) => (
                <CatalogNavItem key={item.key} item={item} active={active === item.key} compact />
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}

function CatalogNavItem({
  item,
  active,
  compact = false,
}: {
  item: (typeof MAIN_ITEMS)[number] | (typeof ADVANCED_ITEMS)[number];
  active: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-left font-medium transition-colors duration-150',
        compact ? 'text-xs' : 'text-sm',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className={cn('shrink-0', compact ? 'size-3.5' : 'size-4')} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

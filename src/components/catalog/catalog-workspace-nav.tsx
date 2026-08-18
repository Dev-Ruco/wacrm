'use client';

import Link from 'next/link';
import {
  Activity,
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

const ITEMS: Array<{
  key: CatalogWorkspaceKey;
  label: string;
  href: string;
  icon: typeof Activity;
}> = [
  { key: 'overview', label: 'Catálogos', href: '/catalog', icon: FolderOpen },
  { key: 'steward', label: 'Agente do Catálogo', href: '/catalog?view=steward', icon: Sparkles },
  { key: 'sources', label: 'Fontes', href: '/catalog?view=external', icon: Database },
  { key: 'structure', label: 'Estrutura', href: '/catalog?view=offerings', icon: Layers3 },
  { key: 'taxonomy', label: 'Categorias', href: '/catalog?view=taxonomy', icon: SlidersHorizontal },
  { key: 'compositions', label: 'Composições', href: '/catalog?view=compositions', icon: GitBranch },
  { key: 'operations', label: 'Operações', href: '/operations', icon: Settings2 },
];

export function CatalogWorkspaceNav({ active }: { active: CatalogWorkspaceKey }) {
  return (
    <nav
      aria-label="Navegação do catálogo"
      className="flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-2 shadow-[var(--wacrm-shadow-sm)] [scrollbar-width:none] md:flex-wrap md:overflow-x-visible [&::-webkit-scrollbar]:hidden"
    >
      {ITEMS.map((item) => {
        const selected =
          active === item.key || (active === 'offers' && item.key === 'overview');
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

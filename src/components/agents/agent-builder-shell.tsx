'use client';

import type { ReactNode } from 'react';
import { Pause, Play, Sparkles } from 'lucide-react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type Section =
  | 'overview'
  | 'identity'
  | 'skills'
  | 'tools'
  | 'knowledge'
  | 'memory'
  | 'security'
  | 'runtime'
  | 'playground'
  | 'flow'
  | 'suggestions'
  | 'eval'
  | 'usage';

interface NavItem {
  id: Section;
  gated?: boolean;
}

type Locale = 'pt' | 'en';

const NAV_ITEMS: NavItem[] = [
  { id: 'overview' },
  { id: 'identity' },
  { id: 'knowledge' },
  { id: 'tools' },
  { id: 'skills' },
  { id: 'memory' },
  { id: 'security' },
  { id: 'runtime' },
  { id: 'playground' },
  { id: 'flow' },
  { id: 'suggestions' },
  { id: 'eval', gated: true },
  { id: 'usage', gated: true },
];

const COPY = {
  pt: {
    eyebrow: 'Agente IA',
    unnamed: 'Agente sem nome',
    noRole: 'Sem papel definido',
    active: 'Activo',
    paused: 'Pausado',
    test: 'Testar agente',
    pause: 'Pausar',
    activate: 'Activar',
    navLabel: 'Navegação do agente',
    overview: 'Visão geral',
    identity: 'Comportamento',
    knowledge: 'Conhecimento',
    tools: 'Ferramentas',
    skills: 'Skills',
    memory: 'Memória',
    security: 'Segurança',
    runtime: 'Runtime',
    playground: 'Testar',
    flow: 'Fluxo ao vivo',
    suggestions: 'Lições',
    eval: 'Avaliação',
    usage: 'Utilização',
  },
  en: {
    eyebrow: 'AI Agent',
    unnamed: 'Unnamed agent',
    noRole: 'No role defined',
    active: 'Active',
    paused: 'Paused',
    test: 'Test agent',
    pause: 'Pause',
    activate: 'Activate',
    navLabel: 'Agent navigation',
    overview: 'Overview',
    identity: 'Behaviour',
    knowledge: 'Knowledge',
    tools: 'Tools',
    skills: 'Skills',
    memory: 'Memory',
    security: 'Security',
    runtime: 'Runtime',
    playground: 'Test',
    flow: 'Live flow',
    suggestions: 'Learnings',
    eval: 'Evaluation',
    usage: 'Usage',
  },
} satisfies Record<Locale, Record<string, string>>;

// Kept for callers that need a stable non-rendered label. UI rendering below
// localizes labels using the active locale.
export function sectionLabel(id: Section): string {
  return COPY.pt[id];
}

export function AgentBuilderShell({
  active,
  onNavigate,
  agentName,
  agentRole,
  isActive,
  onToggleActive,
  canToggleActive,
  canViewUsage,
  children,
}: {
  active: Section;
  onNavigate: (section: Section) => void;
  agentName: string;
  agentRole: string;
  isActive: boolean;
  onToggleActive?: () => void;
  canToggleActive: boolean;
  canViewUsage: boolean;
  children: ReactNode;
}) {
  const locale = useLocale();
  const copy = COPY[locale.startsWith('pt') ? 'pt' : 'en'];
  const visibleItems = NAV_ITEMS.filter((item) => !item.gated || canViewUsage);

  return (
    <div className="wacrm-page min-w-0 space-y-5">
      <header className="wacrm-page-header">
        <div className="min-w-0">
          <p className="text-label text-primary">{copy.eyebrow}</p>
          <div className="mt-1 flex items-center gap-2.5">
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                isActive
                  ? 'bg-[var(--wacrm-success)] shadow-[0_0_0_4px_rgb(31_138_112_/_0.12)]'
                  : 'bg-muted-foreground'
              )}
              aria-hidden="true"
            />
            <h1 className="truncate text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
              {agentName || copy.unnamed}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {agentRole || copy.noRole} · WhatsApp ·{' '}
            <span className={cn('font-medium', isActive && 'text-[var(--wacrm-success)]')}>
              {isActive ? copy.active : copy.paused}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate('playground')}>
            <Sparkles className="size-4" />
            {copy.test}
          </Button>
          {canToggleActive && onToggleActive ? (
            <Button
              variant={isActive ? 'outline' : 'default'}
              size="sm"
              onClick={onToggleActive}
            >
              {isActive ? <Pause className="size-4" /> : <Play className="size-4" />}
              {isActive ? copy.pause : copy.activate}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="wacrm-surface overflow-hidden">
        <nav
          aria-label={copy.navLabel}
          className="flex min-w-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-2 [scrollbar-width:none] md:flex-wrap md:overflow-x-visible [&::-webkit-scrollbar]:hidden"
        >
          {visibleItems.map((item) => {
            const selected = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {copy[item.id]}
              </button>
            );
          })}
        </nav>

        <section className="min-w-0 bg-background/40 p-4 sm:p-5 lg:p-6">
          {children}
        </section>
      </div>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import { Pause, Play, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';

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
  label: string;
  gated?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { id: 'overview', label: 'Visão Geral', items: [{ id: 'overview', label: 'Visão Geral' }] },
  {
    id: 'configure',
    label: 'Configurar',
    items: [
      { id: 'identity', label: 'Identidade & Comportamento' },
      { id: 'skills', label: 'Skills' },
      { id: 'tools', label: 'Ferramentas' },
      { id: 'knowledge', label: 'Conhecimento' },
      { id: 'memory', label: 'Memória' },
    ],
  },
  {
    id: 'control',
    label: 'Controlar',
    items: [
      { id: 'security', label: 'Segurança & Handoff' },
      { id: 'runtime', label: 'Modelo & Runtime' },
    ],
  },
  { id: 'test', label: 'Testar', items: [{ id: 'playground', label: 'Playground' }] },
  {
    id: 'observe',
    label: 'Observar',
    items: [
      { id: 'flow', label: 'Fluxo ao vivo' },
      { id: 'suggestions', label: 'Lições' },
      { id: 'eval', label: 'Avaliação', gated: true },
      { id: 'usage', label: 'Utilização', gated: true },
    ],
  },
];

export function sectionLabel(id: Section): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item.label;
  }
  return '';
}

function groupOf(id: Section): NavGroup {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === id)) ?? NAV_GROUPS[0];
}

/**
 * Agent workspace shell — a header card (identity + status + actions)
 * over a two-row *horizontal* sub-navigation, replacing the 288px
 * vertical rail this used to render. That rail sat next to the app's
 * own contextual submenu (Automação → Agentes IA, ~192px), so the
 * page had two nested sidebars eating ~504px before any content
 * started — this shell now contributes zero vertical rails, per the
 * "one contextual submenu, maximum workspace" rule.
 *
 * Row 1 picks a group (Visão Geral / Configurar / Controlar / Testar
 * / Observar); row 2 only appears when the active group has more
 * than one section, so single-item groups don't waste a row.
 */
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
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.gated || canViewUsage),
  })).filter((group) => group.items.length > 0);

  const activeGroup = groupOf(active);
  const activeGroupItems = visibleGroups.find((g) => g.id === activeGroup.id)?.items ?? [];

  return (
    <div className="mt-4 space-y-4">
      {/* Agent header — identity + status + primary actions. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              isActive ? 'bg-primary shadow-[0_0_0_3px_var(--primary-soft)]' : 'bg-muted-foreground',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">
              {agentName || 'Agente sem nome'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {agentRole || 'Sem papel definido'} · WhatsApp
              <span className={cn('ml-1.5 font-medium', isActive ? 'text-primary' : 'text-muted-foreground')}>
                · {isActive ? 'Activo' : 'Pausado'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate('playground')}>
            <Sparkles className="size-4" />
            Testar agente
          </Button>
          {canToggleActive && onToggleActive ? (
            <Button variant={isActive ? 'outline' : 'default'} size="sm" onClick={onToggleActive}>
              {isActive ? <Pause className="size-4" /> : <Play className="size-4" />}
              {isActive ? 'Pausar' : 'Activar'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <SegmentedControl
          items={visibleGroups.map((g) => ({ value: g.id, label: g.label }))}
          value={activeGroup.id}
          onChange={(groupId) => {
            const group = visibleGroups.find((g) => g.id === groupId);
            if (group) onNavigate(group.items[0].id);
          }}
        />
        {activeGroupItems.length > 1 ? (
          <SegmentedControl
            items={activeGroupItems.map((item) => ({ value: item.id, label: item.label }))}
            value={active}
            onChange={(id) => onNavigate(id as Section)}
            className="bg-transparent p-0"
          />
        ) : null}
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

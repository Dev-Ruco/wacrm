import {
  Bot,
  LayoutDashboard,
  MessageSquare,
  PackageSearch,
  Radio,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of truth for the top-level navigation and the areas that need
 * one shared contextual submenu. Modules that already provide a purpose-built
 * workspace rail (currently Agents and Catalog) deliberately have no shell
 * submenu so users never see two local navigation systems at once.
 */

export interface NavSubItem {
  href: string;
  labelKey: string;
  beta?: boolean;
}

export interface NavArea {
  key: string;
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Route prefixes that count as "inside this area" for active-state + submenu selection. */
  matchPrefixes: string[];
  submenu?: NavSubItem[];
}

export const NAV_AREAS: NavArea[] = [
  {
    key: 'dashboard',
    href: '/dashboard',
    labelKey: 'dashboard',
    icon: LayoutDashboard,
    matchPrefixes: ['/dashboard'],
  },
  {
    key: 'conversas',
    href: '/inbox',
    labelKey: 'conversas',
    icon: MessageSquare,
    matchPrefixes: ['/inbox'],
  },
  {
    key: 'crm',
    href: '/contacts',
    labelKey: 'crm',
    icon: Users,
    matchPrefixes: ['/contacts', '/pipelines', '/visits'],
    submenu: [
      { href: '/contacts', labelKey: 'contacts' },
      { href: '/pipelines', labelKey: 'pipeline' },
      { href: '/visits', labelKey: 'visits' },
    ],
  },
  {
    key: 'agentes',
    href: '/agents',
    labelKey: 'agentes',
    icon: Bot,
    matchPrefixes: ['/agents'],
  },
  {
    key: 'catalogo',
    href: '/catalog',
    labelKey: 'catalogo',
    icon: PackageSearch,
    matchPrefixes: ['/catalog', '/operations'],
  },
  {
    key: 'automacao',
    href: '/automations',
    labelKey: 'automacao',
    icon: Zap,
    matchPrefixes: ['/automations', '/flows'],
    submenu: [
      { href: '/automations', labelKey: 'rules' },
      { href: '/flows', labelKey: 'flows', beta: true },
    ],
  },
  {
    key: 'campanhas',
    href: '/broadcasts',
    labelKey: 'campanhas',
    icon: Radio,
    matchPrefixes: ['/broadcasts'],
  },
];

export function findActiveArea(pathname: string): NavArea | undefined {
  return NAV_AREAS.find((area) =>
    area.matchPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  );
}

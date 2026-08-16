import {
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  PackageSearch,
  Radio,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the top-level navigation and its
 * per-area contextual submenus. Replaces the old flat sidebar
 * `navItems` array and the header's separate (and previously
 * stale) path→title map — both the active-area highlight and the
 * page title now derive from this one config.
 *
 * Submenu entries only ever point at routes that already exist and
 * render real content on their own — the shell never introduces a
 * link a page can't yet serve (e.g. Catálogo's other five internal
 * tabs stay inside that page's own `Tabs` until it's rebuilt to read
 * a URL param, so they aren't listed here yet).
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
    key: "dashboard",
    href: "/dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    matchPrefixes: ["/dashboard"],
  },
  {
    key: "conversas",
    href: "/inbox",
    labelKey: "conversas",
    icon: MessageSquare,
    matchPrefixes: ["/inbox"],
  },
  {
    key: "contactos",
    href: "/contacts",
    labelKey: "contactos",
    icon: Users,
    matchPrefixes: ["/contacts"],
  },
  {
    key: "vendas",
    href: "/pipelines",
    labelKey: "vendas",
    icon: GitBranch,
    matchPrefixes: ["/pipelines", "/visits"],
    submenu: [
      { href: "/pipelines", labelKey: "pipeline" },
      { href: "/visits", labelKey: "visits" },
    ],
  },
  {
    key: "catalogo",
    href: "/catalog",
    labelKey: "catalogo",
    icon: PackageSearch,
    matchPrefixes: ["/catalog", "/operations"],
    submenu: [
      { href: "/catalog", labelKey: "products" },
      { href: "/operations", labelKey: "operations" },
    ],
  },
  {
    key: "automacao",
    href: "/automations",
    labelKey: "automacao",
    icon: Zap,
    matchPrefixes: ["/automations", "/flows", "/agents"],
    submenu: [
      { href: "/automations", labelKey: "rules" },
      { href: "/flows", labelKey: "flows", beta: true },
      { href: "/agents", labelKey: "aiAgents" },
    ],
  },
  {
    key: "campanhas",
    href: "/broadcasts",
    labelKey: "campanhas",
    icon: Radio,
    matchPrefixes: ["/broadcasts"],
  },
];

export function findActiveArea(pathname: string): NavArea | undefined {
  return NAV_AREAS.find((area) =>
    area.matchPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  );
}

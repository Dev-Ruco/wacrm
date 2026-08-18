'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Crown,
  LogOut,
  MessageSquare,
  Settings as SettingsIcon,
  Shield,
  User,
  UserCog,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { NAV_AREAS, findActiveArea, type NavArea } from '@/lib/navigation/nav-areas';
import type { AccountRole } from '@/lib/auth/roles';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/layout/mode-toggle';

const COLLAPSE_KEY = 'wacrm:sidebar:collapsed';

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-primary/20 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-border bg-muted text-muted-foreground',
  },
};

type SidebarGroup = {
  label?: string;
  keys: string[];
};

const SIDEBAR_GROUPS: SidebarGroup[] = [
  { keys: ['dashboard', 'conversas'] },
  { label: 'CRM', keys: ['crm'] },
  { label: 'VENDAS', keys: ['catalogo', 'campanhas'] },
  { label: 'AUTOMAÇÃO', keys: ['agentes', 'automacao'] },
];

function areasForGroup(group: SidebarGroup): NavArea[] {
  return group.keys
    .map((key) => NAV_AREAS.find((area) => area.key === key))
    .filter((area): area is NavArea => Boolean(area));
}

export function AppSidebar() {
  const t = useTranslations('Nav');
  const tRoles = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const activeArea = findActiveArea(pathname);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === 'true');
    } catch {
      // Device persistence is optional.
    }
  }, []);

  const setCollapsedPersisted = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  };

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  const settingsActive = pathname.startsWith('/settings');
  const notificationsActive = pathname.startsWith('/notifications');

  return (
    <aside
      className={cn(
        'hidden h-screen shrink-0 flex-col border-r border-white/8 bg-[var(--wacrm-sidebar)] text-white transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-60'
      )}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--wacrm-primary)] shadow-sm">
            <MessageSquare className="size-[18px] text-white" />
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">WACRM</p>
              <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
                Atendimento & CRM
              </p>
            </div>
          ) : null}
        </Link>

        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsedPersisted(true)}
            className="flex size-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/8 hover:text-white"
            aria-label="Recolher menu"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsedPersisted(false)}
          className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/8 hover:text-white"
          aria-label="Expandir menu"
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        <div className="space-y-4">
          {SIDEBAR_GROUPS.map((group, groupIndex) => {
            const areas = areasForGroup(group);
            return (
              <section key={group.label ?? `primary-${groupIndex}`}>
                {!collapsed && group.label ? (
                  <p className="mb-1.5 px-3 text-[9px] font-semibold tracking-[0.14em] text-white/28">
                    {group.label}
                  </p>
                ) : null}
                <div className="space-y-1">
                  {areas.map((area) => {
                    const isActive = area.key === activeArea?.key;
                    const showUnread = area.key === 'conversas' && totalUnread > 0;
                    const Icon = area.icon;

                    return (
                      <div key={area.key} className="space-y-1">
                        <Link
                          href={area.href}
                          title={collapsed ? t(`areas.${area.labelKey}`) : undefined}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-[var(--wacrm-primary)] text-white shadow-sm'
                              : 'text-white/60 hover:bg-white/7 hover:text-white'
                          )}
                        >
                          <Icon className="size-[18px] shrink-0" />
                          {!collapsed ? (
                            <>
                              <span className="min-w-0 flex-1 truncate">
                                {t(`areas.${area.labelKey}`)}
                              </span>
                              {showUnread ? (
                                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/12 px-1.5 text-[10px] font-semibold text-white">
                                  {totalUnread > 99 ? '99+' : totalUnread}
                                </span>
                              ) : null}
                            </>
                          ) : showUnread ? (
                            <span className="absolute right-2 top-2 size-2 rounded-full bg-white ring-2 ring-[var(--wacrm-primary)]" />
                          ) : null}
                        </Link>

                        {!collapsed && isActive && area.submenu?.length ? (
                          <div className="ml-[18px] border-l border-white/9 pl-4">
                            {area.submenu.map((item) => {
                              const isSubActive =
                                pathname === item.href || pathname.startsWith(`${item.href}/`);
                              return (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  className={cn(
                                    'flex min-h-8 items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] transition-colors',
                                    isSubActive
                                      ? 'bg-white/9 text-white'
                                      : 'text-white/42 hover:bg-white/6 hover:text-white/80'
                                  )}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {t(`submenu.${item.labelKey}`)}
                                  </span>
                                  {item.beta ? (
                                    <span className="rounded-full border border-white/12 bg-white/6 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/50">
                                      {t('beta')}
                                    </span>
                                  ) : null}
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      <div className="shrink-0 border-t border-white/8 p-3">
        <div className="mb-2 space-y-1">
          <Link
            href="/notifications"
            title={collapsed ? t('notifications') : undefined}
            className={cn(
              'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              notificationsActive
                ? 'bg-white/10 text-white'
                : 'text-white/56 hover:bg-white/7 hover:text-white'
            )}
          >
            <Bell className="size-[18px] shrink-0" />
            {!collapsed ? <span className="flex-1">{t('notifications')}</span> : null}
            {unreadNotifications > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wacrm-primary)] px-1.5 text-[10px] font-semibold text-white">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            ) : null}
          </Link>

          <Link
            href="/settings?tab=overview"
            title={collapsed ? t('menuSettings') : undefined}
            className={cn(
              'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              settingsActive
                ? 'bg-white/10 text-white'
                : 'text-white/56 hover:bg-white/7 hover:text-white'
            )}
          >
            <SettingsIcon className="size-[18px] shrink-0" />
            {!collapsed ? <span>{t('menuSettings')}</span> : null}
          </Link>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-xl p-2 text-left transition-colors hover:bg-white/7 focus:outline-none',
              collapsed && 'justify-center'
            )}
            aria-label={t('openAccountMenu')}
          >
            <Avatar className="size-8 shrink-0">
              {profile?.avatar_url ? (
                <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? t('defaultAvatar')} />
              ) : null}
              <AvatarFallback className="bg-white/10 text-sm font-medium text-white">
                {initial}
              </AvatarFallback>
            </Avatar>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white">
                  {profile?.full_name ?? t('defaultUser')}
                </p>
                <p className="truncate text-[10px] text-white/38">
                  {account?.name ?? profile?.email ?? ''}
                </p>
              </div>
            ) : null}
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="right" sideOffset={10} className="min-w-60">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.full_name ?? t('defaultUser')}
              </p>
              <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ''}</p>
              {accountRole
                ? (() => {
                    const metadata = ROLE_CHIP[accountRole];
                    const Icon = metadata.icon;
                    return (
                      <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${metadata.className}`}>
                        <Icon className="size-3" />
                        {tRoles(metadata.labelKey)}
                      </span>
                    );
                  })()
                : null}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
              <User className="size-4" />
              {t('menuProfile')}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings?tab=overview" />}>
              <SettingsIcon className="size-4" />
              {t('menuSettings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs text-muted-foreground">Aparência</span>
              <ModeToggle />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="size-4" />
              {t('menuSignOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
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
import { NAV_AREAS, findActiveArea } from '@/lib/navigation/nav-areas';
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

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-white/15 bg-white/8 text-white',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-white/10 bg-white/5 text-white/80',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-white/10 bg-white/5 text-white/65',
  },
};

export function AppSidebar() {
  const t = useTranslations('Nav');
  const tRoles = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const activeArea = findActiveArea(pathname);
  const [collapsed, setCollapsed] = useState(false);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

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
              <p className="truncate text-[11px] text-white/45">Workspace</p>
            </div>
          ) : null}
        </Link>

        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex size-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/8 hover:text-white"
            aria-label="Recolher menu"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/8 hover:text-white"
          aria-label="Expandir menu"
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        <div className="space-y-1">
          {NAV_AREAS.map((area) => {
            const isActive = area.key === activeArea?.key;
            const showUnread = area.key === 'conversas' && totalUnread > 0;
            const Icon = area.icon;

            return (
              <div key={area.key} className="space-y-1">
                <Link
                  href={area.href}
                  title={collapsed ? t(`areas.${area.labelKey}`) : undefined}
                  className={cn(
                    'group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[var(--wacrm-primary)] text-white shadow-sm'
                      : 'text-white/62 hover:bg-white/7 hover:text-white'
                  )}
                >
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {t(`areas.${area.labelKey}`)}
                      </span>
                      {showUnread ? (
                        <span
                          className={cn(
                            'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold',
                            isActive ? 'bg-white/16 text-white' : 'bg-white/10 text-white'
                          )}
                        >
                          {totalUnread > 99 ? '99+' : totalUnread}
                        </span>
                      ) : null}
                    </>
                  ) : showUnread ? (
                    <span className="absolute ml-5 mt-[-22px] size-2 rounded-full bg-white" />
                  ) : null}
                </Link>

                {!collapsed && isActive && area.submenu?.length ? (
                  <div className="ml-[18px] border-l border-white/10 pl-4">
                    {area.submenu.map((item) => {
                      const isSubActive =
                        pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'flex min-h-9 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors',
                            isSubActive
                              ? 'bg-white/10 text-white'
                              : 'text-white/48 hover:bg-white/6 hover:text-white/80'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {t(`submenu.${item.labelKey}`)}
                          </span>
                          {item.beta ? (
                            <span className="rounded-full border border-white/12 bg-white/6 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/55">
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
      </nav>

      <div className="shrink-0 border-t border-white/8 p-3">
        <div className="mb-2 space-y-1">
          <Link
            href="/notifications"
            title={collapsed ? t('notifications') : undefined}
            className="relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/58 transition-colors hover:bg-white/7 hover:text-white"
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
            href="/settings?tab=whatsapp"
            title={collapsed ? t('menuSettings') : undefined}
            className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/58 transition-colors hover:bg-white/7 hover:text-white"
          >
            <SettingsIcon className="size-[18px] shrink-0" />
            {!collapsed ? <span>{t('menuSettings')}</span> : null}
          </Link>
        </div>

        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2 text-left transition-colors hover:bg-white/7 focus:outline-none',
                collapsed && 'flex-none'
              )}
              aria-label={t('openAccountMenu')}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t('defaultAvatar')}
                  />
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
                  <p className="truncate text-[10px] text-white/42">
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
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ''}
                </p>
                {accountRole ? (() => {
                  const metadata = ROLE_CHIP[accountRole];
                  const Icon = metadata.icon;
                  return (
                    <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${metadata.className}`}>
                      <Icon className="size-3" />
                      {tRoles(metadata.labelKey)}
                    </span>
                  );
                })() : null}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
                <User className="size-4" />
                {t('menuProfile')}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/settings?tab=whatsapp" />}>
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
      </div>
    </aside>
  );
}

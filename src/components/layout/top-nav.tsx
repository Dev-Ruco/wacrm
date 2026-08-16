'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bell,
  Crown,
  LogOut,
  Menu,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    className:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-border bg-card text-muted-foreground',
  },
};

/**
 * Global top navigation — replaces the old fixed vertical `Sidebar` +
 * slim `Header`. Renders the 7 primary areas from `NAV_AREAS`, plus
 * the header utilities (notifications, mode toggle, single account
 * menu). On mobile the areas collapse into a `Sheet` drawer behind a
 * hamburger button instead of the old hand-rolled slide-out panel.
 *
 * Deliberately does not render a page `<h1>` — every page already
 * renders its own, so the old header's title (and its stale
 * path→title map) would only have duplicated it.
 */
export function TopNav() {
  const t = useTranslations('Nav');
  const tRoles = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const activeArea = findActiveArea(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  return (
    <header className="border-sidebar-border bg-sidebar flex h-14 shrink-0 items-center gap-2 border-b px-3 lg:gap-1 lg:px-4">
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 pr-2">
        <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg">
          <MessageSquare className="h-4 w-4" />
        </div>
        <span className="text-sidebar-foreground hidden text-sm font-semibold sm:inline">
          WACRM
        </span>
      </Link>

      {/* Desktop primary nav */}
      <nav
        className="hidden h-full items-stretch gap-0.5 lg:flex"
        aria-label="Primary"
      >
        {NAV_AREAS.map((area) => {
          const isActive = area.key === activeArea?.key;
          const showUnreadDot =
            area.key === 'conversas' && totalUnread > 0 && !isActive;
          return (
            <Link
              key={area.key}
              href={area.href}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-sidebar-foreground'
                  : 'text-sidebar-foreground/65 hover:text-sidebar-foreground border-transparent'
              )}
            >
              {t(`areas.${area.labelKey}`)}
              {showUnreadDot ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                  <span className="bg-primary relative inline-flex h-1.5 w-1.5 rounded-full" />
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Mobile hamburger */}
      <MobileNav activeAreaKey={activeArea?.key} totalUnread={totalUnread} />

      <DropdownMenu>
        <DropdownMenuTrigger
          className="text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground data-popup-open:bg-sidebar-accent relative flex h-9 w-9 items-center justify-center rounded-md transition-colors focus:outline-none"
          aria-label={t('notifications')}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadNotifications > 0 ? (
            <span
              aria-label={t('unreadNotifications', {
                count: unreadNotifications,
              })}
              className="bg-primary text-primary-foreground absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold"
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="bg-popover text-popover-foreground ring-border min-w-48"
        >
          <DropdownMenuItem
            render={
              <Link
                href="/notifications"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <Bell className="size-4" />
            {t('viewAllNotifications')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ModeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger
          className="hover:bg-sidebar-accent focus:bg-sidebar-accent data-popup-open:bg-sidebar-accent flex items-center gap-2 rounded-md px-1 py-1 transition-colors focus:outline-none sm:pr-2"
          aria-label={t('openAccountMenu')}
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile.full_name ?? t('defaultAvatar')}
              />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initial}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="bg-popover text-popover-foreground ring-border min-w-56"
        >
          <div className="px-2 py-1.5">
            <p className="text-foreground truncate text-sm font-medium">
              {profile?.full_name ?? t('defaultUser')}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {profile?.email ?? ''}
            </p>
            {showAccountStrip && account?.name ? (
              <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <span className="truncate" title={account.name}>
                  {account.name}
                </span>
                {accountRole
                  ? (() => {
                      const metadata = ROLE_CHIP[accountRole];
                      const Icon = metadata.icon;
                      return (
                        <span
                          className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${metadata.className}`}
                        >
                          <Icon className="size-3" />
                          {tRoles(metadata.labelKey)}
                        </span>
                      );
                    })()
                  : null}
              </div>
            ) : null}
          </div>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <User className="size-4" />
            {t('menuProfile')}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=whatsapp"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
            {t('menuSettings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={signOut}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <LogOut className="size-4" />
            {t('menuSignOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function MobileNav({
  activeAreaKey,
  totalUnread,
}: {
  activeAreaKey?: string;
  totalUnread: number;
}) {
  const t = useTranslations('Nav');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openMenu')}
        className="text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-10 w-10 items-center justify-center rounded-md transition-colors lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>WACRM</SheetTitle>
          </SheetHeader>
          <nav
            className="flex flex-col gap-1 overflow-y-auto px-2 pb-4"
            aria-label="Primary"
          >
            {NAV_AREAS.map((area) => {
              const isActive = area.key === activeAreaKey;
              const showUnreadDot =
                area.key === 'conversas' && totalUnread > 0 && !isActive;
              return (
                <Link
                  key={area.key}
                  href={area.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <area.icon className="h-4 w-4" />
                  <span className="flex-1">{t(`areas.${area.labelKey}`)}</span>
                  {showUnreadDot ? (
                    <span className="bg-primary h-2 w-2 rounded-full" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

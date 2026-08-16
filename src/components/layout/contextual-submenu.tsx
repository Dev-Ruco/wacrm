'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { NavArea } from '@/lib/navigation/nav-areas';

/**
 * The second navigation tier: a short list of routes that belong to
 * the active top-level area. Renders nothing when the area has no
 * `submenu` (most areas don't need one — see `nav-areas.ts`).
 *
 * Vertical column on desktop, horizontal scroll strip below `lg`.
 */
export function ContextualSubmenu({ area }: { area: NavArea }) {
  const t = useTranslations('Nav');
  const pathname = usePathname();

  if (!area.submenu?.length) return null;

  return (
    <aside
      aria-label={t(`areas.${area.labelKey}`)}
      className="border-border bg-sidebar/40 w-full shrink-0 border-b px-3 py-2 lg:w-48 lg:border-r lg:border-b-0 lg:px-3 lg:py-4"
    >
      <nav
        className={cn(
          'flex [scrollbar-width:none] gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden',
          'lg:flex-col lg:overflow-visible'
        )}
      >
        {area.submenu.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                'lg:w-full',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span className="flex-1">{t(`submenu.${item.labelKey}`)}</span>
              {item.beta ? (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-600 uppercase dark:text-amber-300">
                  {t('beta')}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

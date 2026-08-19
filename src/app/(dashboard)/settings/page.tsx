'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { AudioTranscriptionSettings } from '@/components/settings/audio-transcription-settings';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { HandoffTeamsPanel } from '@/components/settings/handoff-teams-panel';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { DatabaseIntegrations } from '@/components/settings/database-integrations';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency]
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    audio: <AudioTranscriptionSettings />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: (
      <div className="space-y-8">
        <MembersTab />
        <HandoffTeamsPanel />
      </div>
    ),
    database: <DatabaseIntegrations />,
    api: <ApiKeysSettings />,
  };

  const sectionLabel = (value: SettingsSection) =>
    value === 'audio' || value === 'database'
      ? SECTION_META[value].label
      : t(`sections.${value}`);

  return (
    <div className="wacrm-page space-y-5">
      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">Sistema</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">
            {t('pageTitle')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('pageDesc')}
          </p>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="wacrm-surface h-fit overflow-hidden lg:sticky lg:top-0">
          <nav aria-label="Definições" className="p-2">
            {RAIL_GROUPS.map(({ group, label }) => {
              const items = SETTINGS_SECTIONS.filter(
                (item) => SECTION_META[item].group === group
              );
              if (items.length === 0) return null;
              return (
                <div key={group} className="mb-3 last:mb-0">
                  {label ? (
                    <p className="text-label px-2 pb-1.5 pt-1 text-muted-foreground">
                      {t(`groups.${group}`)}
                    </p>
                  ) : null}
                  <div className="space-y-1">
                    {items.map((item) => {
                      const selected = section === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => go(item)}
                          aria-current={selected ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors',
                            selected
                              ? 'bg-primary-soft text-primary'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {sectionLabel(item)}
                          </span>
                          {hints[item] != null ? (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {hints[item]}
                            </span>
                          ) : selected ? (
                            <ChevronRight className="size-3.5 shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0">
          <div className="mb-4">
            <h2 className="text-section-title">{sectionLabel(section)}</h2>
          </div>
          <div className="min-w-0">{panel[section]}</div>
        </section>
      </div>
    </div>
  );
}

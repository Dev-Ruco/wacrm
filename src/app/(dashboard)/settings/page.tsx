'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SegmentedControl } from '@/components/ui/segmented-control';
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
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { DatabaseIntegrations } from '@/components/settings/database-integrations';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

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
    members: <MembersTab />,
    database: <DatabaseIntegrations />,
    api: <ApiKeysSettings />,
  };

  // Sections without an i18n key yet fall back to their hard-coded
  // `SECTION_META` label rather than rendering a raw "sections.x" key.
  const sectionLabel = (s: SettingsSection) =>
    s === 'audio' || s === 'database'
      ? SECTION_META[s].label
      : t(`sections.${s}`);

  const activeGroup = SECTION_META[section].group;
  const groupItems = SETTINGS_SECTIONS.filter(
    (s) => SECTION_META[s].group === activeGroup
  );

  return (
    <div>
      <div>
        <h1 className="text-page-title">{t('pageTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('pageDesc')}</p>
      </div>

      {/* Same two-tier horizontal SegmentedControl pattern as the
          Agentes workspace — one contextual submenu (the global one),
          never a second vertical rail next to it. */}
      <div className="mt-6 space-y-2">
        <SegmentedControl
          items={RAIL_GROUPS.map(({ label, group }) => ({
            value: group,
            // The ungrouped "top" bucket (just Overview) has no group
            // label — show its one section's own name on the tab.
            label: label
              ? t(`groups.${group}`)
              : sectionLabel(
                  SETTINGS_SECTIONS.find(
                    (s) => SECTION_META[s].group === group
                  )!
                ),
          }))}
          value={activeGroup}
          onChange={(group) => {
            const first = SETTINGS_SECTIONS.find(
              (s) => SECTION_META[s].group === group
            );
            if (first) go(first);
          }}
        />
        {groupItems.length > 1 ? (
          <SegmentedControl
            items={groupItems.map((s) => ({
              value: s,
              label: sectionLabel(s),
              badge:
                hints[s] != null ? (
                  <span className="text-muted-foreground ml-1 text-xs">
                    {hints[s]}
                  </span>
                ) : undefined,
            }))}
            value={section}
            onChange={(s) => go(s as SettingsSection)}
            className="bg-transparent p-0"
          />
        ) : null}
      </div>

      <div className="mt-6 min-w-0">{panel[section]}</div>
    </div>
  );
}

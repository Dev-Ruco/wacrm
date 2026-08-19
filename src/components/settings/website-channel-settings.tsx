'use client';

import { useEffect, useState } from 'react';
import { Globe2, Loader2, Save } from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';

type WebsiteChannel = {
  id: string;
  name: string;
  public_key: string;
  allowed_origins: string[];
  is_active: boolean;
};

type Locale = 'pt' | 'en';

const COPY = {
  pt: {
    title: 'Canal Website',
    description: 'Permite que o mesmo agente responda no chat do teu site. Só origens autorizadas podem usar este canal.',
    adminsOnly: 'Apenas proprietários e administradores podem configurar o canal Website.',
    loadFailed: 'Não foi possível carregar o canal Website.',
    saveFailed: 'Não foi possível guardar o canal Website.',
    saved: 'Canal Website guardado.',
    name: 'Nome do canal',
    namePlaceholder: 'Website',
    origins: 'Sites autorizados',
    originsHint: 'Uma origem por linha, incluindo https://. Exemplo: https://www.minhaempresa.com',
    active: 'Canal activo',
    activeHint: 'Quando activo, o Website pode iniciar conversas com o agente desta conta.',
    key: 'Chave pública do canal',
    keyHint: 'É criada pelo servidor e identifica este canal no Website. Pode ser partilhada no código cliente; não é uma chave secreta.',
    notCreated: 'Será criada ao guardar o canal pela primeira vez.',
    save: 'Guardar Website',
    invalidOrigins: 'Indica pelo menos um site autorizado, um por linha.',
  },
  en: {
    title: 'Website channel',
    description: 'Lets the same agent answer in your website chat. Only approved origins can use this channel.',
    adminsOnly: 'Only owners and administrators can configure the Website channel.',
    loadFailed: 'Could not load the Website channel.',
    saveFailed: 'Could not save the Website channel.',
    saved: 'Website channel saved.',
    name: 'Channel name',
    namePlaceholder: 'Website',
    origins: 'Allowed websites',
    originsHint: 'One origin per line, including https://. Example: https://www.mycompany.com',
    active: 'Channel active',
    activeHint: 'When active, the Website can start conversations with this account’s agent.',
    key: 'Public channel key',
    keyHint: 'Created by the server to identify this Website channel. It may be used in client code; it is not a secret key.',
    notCreated: 'It will be created when you save the channel for the first time.',
    save: 'Save Website',
    invalidOrigins: 'Enter at least one allowed website, one per line.',
  },
} satisfies Record<Locale, Record<string, string>>;

function originsToText(origins: string[]): string {
  return origins.join('\n');
}

function textToOrigins(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  );
}

export function WebsiteChannelSettings() {
  const locale = useLocale();
  const copy = COPY[locale.startsWith('pt') ? 'pt' : 'en'];
  const { canEditSettings, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channel, setChannel] = useState<WebsiteChannel | null>(null);
  const [name, setName] = useState('Website');
  const [origins, setOrigins] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (profileLoading) return;
    if (!canEditSettings) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/site-chat/channel', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error ?? 'load failed');
        if (cancelled) return;
        const current = (data?.channel ?? null) as WebsiteChannel | null;
        setChannel(current);
        if (current) {
          setName(current.name || 'Website');
          setOrigins(originsToText(current.allowed_origins ?? []));
          setActive(current.is_active !== false);
        }
      } catch (error) {
        console.error('[website settings] load failed:', error);
        if (!cancelled) toast.error(copy.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canEditSettings, copy.loadFailed, profileLoading]);

  async function save() {
    const allowedOrigins = textToOrigins(origins);
    if (allowedOrigins.length === 0) {
      toast.error(copy.invalidOrigins);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/site-chat/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Website',
          allowed_origins: allowedOrigins,
          is_active: active,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? 'save failed');
      setChannel((data?.channel ?? null) as WebsiteChannel | null);
      if (data?.channel) {
        setName(data.channel.name || 'Website');
        setOrigins(originsToText(data.channel.allowed_origins ?? []));
        setActive(data.channel.is_active !== false);
      }
      toast.success(copy.saved);
    } catch (error) {
      console.error('[website settings] save failed:', error);
      toast.error(copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading || loading) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!canEditSettings) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">{copy.adminsOnly}</CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle as="h3" className="flex items-center gap-2 text-base">
          <Globe2 className="h-4 w-4 text-primary" />
          {copy.title}
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="website-channel-name">{copy.name}</Label>
          <Input
            id="website-channel-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy.namePlaceholder}
            maxLength={100}
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website-channel-origins">{copy.origins}</Label>
          <textarea
            id="website-channel-origins"
            value={origins}
            onChange={(event) => setOrigins(event.target.value)}
            rows={5}
            disabled={saving}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">{copy.originsHint}</p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{copy.active}</p>
            <p className="text-xs text-muted-foreground">{copy.activeHint}</p>
          </div>
          <Switch checked={active} onCheckedChange={setActive} disabled={saving} />
        </div>

        <div className="space-y-2 rounded-lg bg-muted/50 p-3">
          <p className="text-sm font-medium text-foreground">{copy.key}</p>
          {channel?.public_key ? (
            <code className="block overflow-x-auto rounded bg-background px-2 py-1.5 text-xs text-foreground">
              {channel.public_key}
            </code>
          ) : (
            <p className="text-xs text-muted-foreground">{copy.notCreated}</p>
          )}
          <p className="text-xs text-muted-foreground">{copy.keyHint}</p>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {copy.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

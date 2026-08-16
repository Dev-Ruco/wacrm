'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Link2,
  Loader2,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/hooks/use-can';

type EntityType = { id: string; key: string; label: string; enabled: boolean };
type Entity = {
  id: string;
  entity_type_id: string;
  name: string;
  external_ref: string | null;
  enabled: boolean;
};
type Offering = {
  id: string;
  name: string;
  offering_type_id: string | null;
  is_active: boolean;
};
type Link = {
  id: string;
  offering_id: string;
  entity_id: string;
  relation_key: string;
  priority: number;
  enabled: boolean;
};
type Window = {
  id: string;
  offering_id: string | null;
  entity_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  capacity: number | null;
  enabled: boolean;
};
type Exception = {
  id: string;
  offering_id: string | null;
  entity_id: string | null;
  starts_at: string;
  ends_at: string;
  status: 'available' | 'unavailable';
  reason: string | null;
  enabled: boolean;
};
type State = {
  entity_types: EntityType[];
  entities: Entity[];
  offerings: Offering[];
  links: Link[];
  windows: Window[];
  exceptions: Exception[];
};

const EMPTY: State = {
  entity_types: [],
  entities: [],
  offerings: [],
  links: [],
  windows: [],
  exceptions: [],
};
const WEEKDAYS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? 'Não foi possível concluir a operação.');
  return data;
}

export default function OperationsPage() {
  const canEdit = useCan('edit-settings');
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [typeLabel, setTypeLabel] = useState('');
  const [typeKey, setTypeKey] = useState('');
  const [entityTypeId, setEntityTypeId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [linkOfferingId, setLinkOfferingId] = useState('');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [relationKey, setRelationKey] = useState('');
  const [windowOfferingId, setWindowOfferingId] = useState('');
  const [windowEntityId, setWindowEntityId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [timezone, setTimezone] = useState('Africa/Maputo');
  const [capacity, setCapacity] = useState('');
  const [exceptionOfferingId, setExceptionOfferingId] = useState('');
  const [exceptionEntityId, setExceptionEntityId] = useState('');
  const [exceptionStarts, setExceptionStarts] = useState('');
  const [exceptionEnds, setExceptionEnds] = useState('');
  const [exceptionStatus, setExceptionStatus] = useState<
    'available' | 'unavailable'
  >('unavailable');
  const [exceptionReason, setExceptionReason] = useState('');

  const typeNames = useMemo(
    () => new Map(state.entity_types.map((item) => [item.id, item.label])),
    [state.entity_types]
  );
  const entityNames = useMemo(
    () => new Map(state.entities.map((item) => [item.id, item.name])),
    [state.entities]
  );
  const offeringNames = useMemo(
    () => new Map(state.offerings.map((item) => [item.id, item.name])),
    [state.offerings]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await responseJson(
        await fetch('/api/business/operations', { cache: 'no-store' })
      );
      setState({
        entity_types: data.entity_types ?? [],
        entities: data.entities ?? [],
        offerings: data.offerings ?? [],
        links: data.links ?? [],
        windows: data.windows ?? [],
        exceptions: data.exceptions ?? [],
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a operação.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    method: 'POST' | 'DELETE',
    body: Record<string, unknown>
  ) {
    return responseJson(
      await fetch('/api/business/operations', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  async function run(operation: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    try {
      await operation();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir a operação.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function createType() {
    const label = typeLabel.trim();
    const key = typeKey.trim() || slug(label);
    if (!label || !key) return;
    await run(async () => {
      await mutate('POST', { entity: 'entity_type', label, key });
      setTypeLabel('');
      setTypeKey('');
      await load();
      toast.success('Tipo de entidade criado.');
    });
  }

  async function createEntity() {
    if (!entityTypeId || !entityName.trim()) return;
    await run(async () => {
      await mutate('POST', {
        entity: 'entity',
        entity_type_id: entityTypeId,
        name: entityName.trim(),
      });
      setEntityName('');
      await load();
      toast.success('Entidade criada.');
    });
  }

  async function createLink() {
    const relation = relationKey.trim() || 'related_to';
    if (!linkOfferingId || !linkEntityId) return;
    await run(async () => {
      await mutate('POST', {
        entity: 'link',
        offering_id: linkOfferingId,
        entity_id: linkEntityId,
        relation_key: slug(relation),
      });
      setRelationKey('');
      await load();
      toast.success('Ligação criada.');
    });
  }

  async function createWindow() {
    if ((!windowOfferingId && !windowEntityId) || !startTime || !endTime)
      return;
    await run(async () => {
      await mutate('POST', {
        entity: 'window',
        offering_id: windowOfferingId || null,
        entity_id: windowEntityId || null,
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        timezone,
        capacity: capacity ? Number(capacity) : null,
      });
      await load();
      toast.success('Janela de disponibilidade criada.');
    });
  }

  async function createException() {
    if (
      (!exceptionOfferingId && !exceptionEntityId) ||
      !exceptionStarts ||
      !exceptionEnds
    )
      return;
    await run(async () => {
      await mutate('POST', {
        entity: 'exception',
        offering_id: exceptionOfferingId || null,
        entity_id: exceptionEntityId || null,
        starts_at: new Date(exceptionStarts).toISOString(),
        ends_at: new Date(exceptionEnds).toISOString(),
        status: exceptionStatus,
        reason: exceptionReason.trim() || null,
      });
      setExceptionReason('');
      await load();
      toast.success('Excepção criada.');
    });
  }

  async function remove(
    entity: 'entity_type' | 'entity' | 'link' | 'window' | 'exception',
    id: string
  ) {
    await run(async () => {
      await mutate('DELETE', { entity, id });
      await load();
      toast.success('Registo removido.');
    });
  }

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Building2 className="text-primary h-6 w-6" />
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Operação
          </h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Pessoas, locais, recursos e horários associados às ofertas da empresa.
        </p>
      </div>

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">Entidades</TabsTrigger>
          <TabsTrigger value="links">Ligações</TabsTrigger>
          <TabsTrigger value="availability">Disponibilidade</TabsTrigger>
        </TabsList>

        <TabsContent value="entities" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UsersRound className="text-primary h-4 w-4" />
                <CardTitle className="text-base">Tipos e entidades</CardTitle>
              </div>
              <CardDescription>
                Defina a linguagem da própria empresa: profissional, filial,
                sala, viatura, equipamento ou outro recurso.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={typeLabel}
                    onChange={(event) => setTypeLabel(event.target.value)}
                    placeholder="Tipo, ex.: Profissional"
                  />
                  <Input
                    value={typeKey}
                    onChange={(event) => setTypeKey(slug(event.target.value))}
                    placeholder={slug(typeLabel) || 'chave_do_tipo'}
                  />
                  <Button
                    disabled={saving || !typeLabel.trim()}
                    onClick={() => void createType()}
                  >
                    <Plus />
                    Tipo
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {state.entity_types.map((item) => (
                  <Badge key={item.id} variant="outline">
                    {item.label} · {item.key}
                  </Badge>
                ))}
              </div>
              {canEdit && (
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={entityTypeId}
                    onChange={(event) => setEntityTypeId(event.target.value)}
                  >
                    <option value="">Tipo de entidade</option>
                    {state.entity_types.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={entityName}
                    onChange={(event) => setEntityName(event.target.value)}
                    placeholder="Nome da pessoa, local ou recurso"
                  />
                  <Button
                    disabled={saving || !entityTypeId || !entityName.trim()}
                    onClick={() => void createEntity()}
                  >
                    <Plus />
                    Entidade
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {state.entities.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {typeNames.get(item.entity_type_id) ??
                          item.entity_type_id}
                      </p>
                    </div>
                    {canEdit && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void remove('entity', item.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Link2 className="text-primary h-4 w-4" />
                <CardTitle className="text-base">Oferta ↔ entidade</CardTitle>
              </div>
              <CardDescription>
                Ligue uma oferta a quem a presta, ao local onde existe ou ao
                recurso necessário. A relação é definida pela empresa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={linkOfferingId}
                    onChange={(event) => setLinkOfferingId(event.target.value)}
                  >
                    <option value="">Oferta</option>
                    {state.offerings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={linkEntityId}
                    onChange={(event) => setLinkEntityId(event.target.value)}
                  >
                    <option value="">Entidade</option>
                    {state.entities.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={relationKey}
                    onChange={(event) =>
                      setRelationKey(slug(event.target.value))
                    }
                    placeholder="provided_by, available_at..."
                  />
                  <Button
                    disabled={saving || !linkOfferingId || !linkEntityId}
                    onClick={() => void createLink()}
                  >
                    <Plus />
                    Ligar
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {state.links.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border px-3 py-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-center"
                  >
                    <span className="text-sm">
                      {offeringNames.get(item.offering_id) ?? item.offering_id}
                    </span>
                    <Badge variant="outline">{item.relation_key}</Badge>
                    <span className="text-sm">
                      {entityNames.get(item.entity_id) ?? item.entity_id}
                    </span>
                    {canEdit && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void remove('link', item.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="availability" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="text-primary h-4 w-4" />
                <CardTitle className="text-base">Horário recorrente</CardTitle>
              </div>
              <CardDescription>
                Uma janela pode aplicar-se a uma oferta, a uma entidade ou às
                duas ao mesmo tempo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <div className="grid gap-2 xl:grid-cols-[1fr_1fr_130px_110px_110px_160px_100px_auto]">
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={windowOfferingId}
                    onChange={(event) =>
                      setWindowOfferingId(event.target.value)
                    }
                  >
                    <option value="">Oferta (opcional)</option>
                    {state.offerings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={windowEntityId}
                    onChange={(event) => setWindowEntityId(event.target.value)}
                  >
                    <option value="">Entidade (opcional)</option>
                    {state.entities.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={weekday}
                    onChange={(event) => setWeekday(event.target.value)}
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                  <Input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="Africa/Maputo"
                  />
                  <Input
                    type="number"
                    min="1"
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    placeholder="Cap."
                  />
                  <Button
                    disabled={saving || (!windowOfferingId && !windowEntityId)}
                    onClick={() => void createWindow()}
                  >
                    <Plus />
                    Janela
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {state.windows.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <Badge variant="secondary">{WEEKDAYS[item.weekday]}</Badge>
                    <span>
                      {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                    </span>
                    <span className="text-muted-foreground">
                      {item.timezone}
                    </span>
                    {item.offering_id && (
                      <span>
                        ·{' '}
                        {offeringNames.get(item.offering_id) ??
                          item.offering_id}
                      </span>
                    )}
                    {item.entity_id && (
                      <span>
                        · {entityNames.get(item.entity_id) ?? item.entity_id}
                      </span>
                    )}
                    {item.capacity && <span>· cap. {item.capacity}</span>}
                    <div className="ml-auto">
                      {canEdit && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => void remove('window', item.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Excepções</CardTitle>
              <CardDescription>
                Feche ou abra explicitamente um período sem alterar o horário
                recorrente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <div className="grid gap-2 xl:grid-cols-[1fr_1fr_190px_190px_130px_1fr_auto]">
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={exceptionOfferingId}
                    onChange={(event) =>
                      setExceptionOfferingId(event.target.value)
                    }
                  >
                    <option value="">Oferta (opcional)</option>
                    {state.offerings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={exceptionEntityId}
                    onChange={(event) =>
                      setExceptionEntityId(event.target.value)
                    }
                  >
                    <option value="">Entidade (opcional)</option>
                    {state.entities.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="datetime-local"
                    value={exceptionStarts}
                    onChange={(event) => setExceptionStarts(event.target.value)}
                  />
                  <Input
                    type="datetime-local"
                    value={exceptionEnds}
                    onChange={(event) => setExceptionEnds(event.target.value)}
                  />
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={exceptionStatus}
                    onChange={(event) =>
                      setExceptionStatus(
                        event.target.value as 'available' | 'unavailable'
                      )
                    }
                  >
                    <option value="unavailable">Indisponível</option>
                    <option value="available">Disponível</option>
                  </select>
                  <Input
                    value={exceptionReason}
                    onChange={(event) => setExceptionReason(event.target.value)}
                    placeholder="Motivo (opcional)"
                  />
                  <Button
                    disabled={
                      saving ||
                      (!exceptionOfferingId && !exceptionEntityId) ||
                      !exceptionStarts ||
                      !exceptionEnds
                    }
                    onClick={() => void createException()}
                  >
                    <Plus />
                    Excepção
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {state.exceptions.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <Badge
                      variant={
                        item.status === 'unavailable'
                          ? 'destructive'
                          : 'default'
                      }
                    >
                      {item.status === 'unavailable'
                        ? 'Indisponível'
                        : 'Disponível'}
                    </Badge>
                    <span>
                      {new Date(item.starts_at).toLocaleString('pt-PT')} →{' '}
                      {new Date(item.ends_at).toLocaleString('pt-PT')}
                    </span>
                    {item.offering_id && (
                      <span>
                        ·{' '}
                        {offeringNames.get(item.offering_id) ??
                          item.offering_id}
                      </span>
                    )}
                    {item.entity_id && (
                      <span>
                        · {entityNames.get(item.entity_id) ?? item.entity_id}
                      </span>
                    )}
                    {item.reason && (
                      <span className="text-muted-foreground">
                        · {item.reason}
                      </span>
                    )}
                    <div className="ml-auto">
                      {canEdit && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => void remove('exception', item.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

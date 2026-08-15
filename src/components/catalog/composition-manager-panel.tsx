'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers3, Loader2, Network, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/hooks/use-can'
import type { Product } from './product-card'

type OfferingType = { id: string; label: string }
type Slot = { id: string; key: string; label: string; required: boolean; offering_type_ids: string[] }
type Template = { id: string; key: string; label: string; enabled: boolean; slots: Slot[] }
type Relation = {
  id: string
  source_product_id: string
  target_product_id: string
  relation_key: string
  score: number | string
  verified: boolean
}
type State = { templates: Template[]; relations: Relation[]; offering_types: OfferingType[] }
type SlotDraft = { label: string; key: string; offeringTypeId: string; required: boolean }

const EMPTY: State = { templates: [], relations: [], offering_types: [] }
const EMPTY_SLOT: SlotDraft = { label: '', key: '', offeringTypeId: '', required: true }

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

async function json(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir a operação.')
  return data
}

export function CompositionManagerPanel({ products }: { products: Product[] }) {
  const canEdit = useCan('edit-settings')
  const [state, setState] = useState<State>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateKey, setTemplateKey] = useState('')
  const [slots, setSlots] = useState<Record<string, SlotDraft>>({})
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [relationKey, setRelationKey] = useState('')
  const [score, setScore] = useState('1')
  const [verified, setVerified] = useState(true)

  const activeProducts = useMemo(
    () => products.filter((product) => product.is_active).sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [products],
  )
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products])
  const typeNames = useMemo(() => new Map(state.offering_types.map((type) => [type.id, type.label])), [state.offering_types])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await json(await fetch('/api/catalog/compositions', { cache: 'no-store' }))
      setState({ templates: data.templates ?? [], relations: data.relations ?? [], offering_types: data.offering_types ?? [] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as composições.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    return json(await fetch('/api/catalog/compositions', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  async function run(operation: () => Promise<void>) {
    if (saving) return
    setSaving(true)
    try {
      await operation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a operação.')
    } finally {
      setSaving(false)
    }
  }

  async function createTemplate() {
    const label = templateLabel.trim()
    const key = templateKey.trim() || slug(label)
    if (!label || !key) return
    await run(async () => {
      await mutate('POST', { entity: 'template', label, key })
      setTemplateLabel('')
      setTemplateKey('')
      await load()
      toast.success('Template criado.')
    })
  }

  async function createSlot(template: Template) {
    const draft = slots[template.id] ?? EMPTY_SLOT
    const label = draft.label.trim()
    const key = draft.key.trim() || slug(label)
    if (!label || !key) return
    await run(async () => {
      await mutate('POST', {
        entity: 'slot', template_id: template.id, label, key,
        required: draft.required, min_items: draft.required ? 1 : 0, max_items: 1,
        offering_type_ids: draft.offeringTypeId ? [draft.offeringTypeId] : [],
        sort_order: template.slots.length * 10,
      })
      setSlots((current) => ({ ...current, [template.id]: { ...EMPTY_SLOT } }))
      await load()
      toast.success('Slot criado.')
    })
  }

  async function createRelation() {
    if (!sourceId || !targetId || sourceId === targetId) return
    await run(async () => {
      await mutate('POST', {
        entity: 'relation', source_product_id: sourceId, target_product_id: targetId,
        relation_key: slug(relationKey || 'related'), score: Number(score), verified,
      })
      setSourceId(''); setTargetId(''); setRelationKey(''); setScore('1'); setVerified(true)
      await load()
      toast.success('Relação criada.')
    })
  }

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">Composições</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">Configure soluções multi-oferta por slots e relações, sem regras fixas por sector.</p>
        <p className="mt-1 text-xs text-muted-foreground">Depois de configurar um template, active “Compor solução” em Agentes → Ferramentas.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates e slots</CardTitle><CardDescription>Um template pode ser um conjunto, pacote, kit, configuração ou outra solução definida pela empresa.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {canEdit && <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input value={templateLabel} onChange={(event) => setTemplateLabel(event.target.value)} placeholder="Nome do template" />
            <Input value={templateKey} onChange={(event) => setTemplateKey(slug(event.target.value))} placeholder={slug(templateLabel) || 'chave_do_template'} />
            <Button disabled={saving || !templateLabel.trim()} onClick={() => void createTemplate()}><Plus />Adicionar</Button>
          </div>}

          {!state.templates.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum template configurado.</p> : state.templates.map((template) => {
            const draft = slots[template.id] ?? EMPTY_SLOT
            return <div key={template.id} className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div><div className="flex items-center gap-2"><span className="font-medium">{template.label}</span><Badge variant={template.enabled ? 'default' : 'secondary'}>{template.enabled ? 'Activo' : 'Inactivo'}</Badge></div><p className="text-xs text-muted-foreground">{template.key}</p></div>
                <div className="flex items-center gap-2">
                  <Switch checked={template.enabled} disabled={!canEdit || saving} onCheckedChange={(enabled) => void run(async () => { await mutate('PATCH', { entity: 'template', id: template.id, enabled }); await load() })} aria-label={`Activar ${template.label}`} />
                  {canEdit && <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => void run(async () => { await mutate('DELETE', { entity: 'template', id: template.id }); await load() })}><Trash2 /></Button>}
                </div>
              </div>

              <div className="mt-3 space-y-2">{template.slots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                <div><div className="flex items-center gap-2"><span className="text-sm font-medium">{slot.label}</span><Badge variant="outline">{slot.key}</Badge>{slot.required && <Badge variant="secondary">Obrigatório</Badge>}</div><p className="text-xs text-muted-foreground">{slot.offering_type_ids.length ? slot.offering_type_ids.map((id) => typeNames.get(id) ?? id).join(', ') : 'Sem tipo fixo · apenas grafo'}</p></div>
                {canEdit && <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => void run(async () => { await mutate('DELETE', { entity: 'slot', id: slot.id }); await load() })}><Trash2 /></Button>}
              </div>)}</div>

              {canEdit && <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto]">
                <Input value={draft.label} onChange={(event) => setSlots((current) => ({ ...current, [template.id]: { ...draft, label: event.target.value } }))} placeholder="Novo slot" />
                <Input value={draft.key} onChange={(event) => setSlots((current) => ({ ...current, [template.id]: { ...draft, key: slug(event.target.value) } }))} placeholder={slug(draft.label) || 'chave_do_slot'} />
                <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={draft.offeringTypeId} onChange={(event) => setSlots((current) => ({ ...current, [template.id]: { ...draft, offeringTypeId: event.target.value } }))}><option value="">Sem tipo fixo</option>{state.offering_types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
                <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm"><Switch checked={draft.required} onCheckedChange={(required) => setSlots((current) => ({ ...current, [template.id]: { ...draft, required } }))} />Obrigatório</label>
                <Button variant="outline" disabled={saving || !draft.label.trim()} onClick={() => void createSlot(template)}><Plus />Slot</Button>
              </div>}
            </div>
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /><CardTitle className="text-base">Grafo de relações</CardTitle></div><CardDescription>As relações são factos explícitos entre ofertas. O motor usa peso e verificação para ordenar candidatos.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {canEdit && <div className="grid gap-2 xl:grid-cols-[1fr_1fr_0.8fr_100px_auto_auto]">
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Oferta de origem</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Oferta relacionada</option>{activeProducts.filter((product) => product.id !== sourceId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
            <Input value={relationKey} onChange={(event) => setRelationKey(slug(event.target.value))} placeholder="compatible, complement..." />
            <Input type="number" min="0" max="1" step="0.05" value={score} onChange={(event) => setScore(event.target.value)} />
            <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm"><Switch checked={verified} onCheckedChange={setVerified} />Verificada</label>
            <Button disabled={saving || !sourceId || !targetId || sourceId === targetId} onClick={() => void createRelation()}><Plus />Relação</Button>
          </div>}

          {!state.relations.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma relação configurada.</p> : <div className="space-y-2">{state.relations.map((relation) => <div key={relation.id} className="grid gap-3 rounded-lg border px-3 py-2 md:grid-cols-[1fr_auto_1fr_auto_auto] md:items-center">
            <span className="truncate text-sm">{productNames.get(relation.source_product_id) ?? relation.source_product_id}</span>
            <div className="flex items-center gap-2"><Badge variant="outline">{relation.relation_key}</Badge><span className="text-xs text-muted-foreground">{Number(relation.score).toFixed(2)}</span></div>
            <span className="truncate text-sm">{productNames.get(relation.target_product_id) ?? relation.target_product_id}</span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={relation.verified} disabled={!canEdit || saving} onCheckedChange={(value) => void run(async () => { await mutate('PATCH', { entity: 'relation', id: relation.id, verified: value }); await load() })} />Verificada</label>
            {canEdit && <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => void run(async () => { await mutate('DELETE', { entity: 'relation', id: relation.id }); await load() })}><Trash2 /></Button>}
          </div>)}</div>}
        </CardContent>
      </Card>
    </div>
  )
}

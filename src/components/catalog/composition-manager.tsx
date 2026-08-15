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

type OfferingType = {
  id: string
  key: string
  label: string
  enabled: boolean
}

type CompositionSlot = {
  id: string
  template_id: string
  key: string
  label: string
  description: string | null
  required: boolean
  min_items: number
  max_items: number
  sort_order: number
  offering_type_ids: string[]
}

type CompositionTemplate = {
  id: string
  key: string
  label: string
  description: string | null
  enabled: boolean
  sort_order: number
  slots: CompositionSlot[]
}

type ProductRelation = {
  id: string
  source_product_id: string
  target_product_id: string
  relation_key: string
  score: number | string
  source: string
  confidence: number | string | null
  verified: boolean
  updated_at: string
}

type ManagerState = {
  templates: CompositionTemplate[]
  relations: ProductRelation[]
  offering_types: OfferingType[]
}

type SlotDraft = {
  label: string
  key: string
  offeringTypeId: string
  required: boolean
}

const EMPTY_STATE: ManagerState = { templates: [], relations: [], offering_types: [] }
const EMPTY_SLOT_DRAFT: SlotDraft = { label: '', key: '', offeringTypeId: '', required: true }

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir a operação.')
  return data
}

export function CompositionManager({ products }: { products: Product[] }) {
  const canEdit = useCan('edit-settings')
  const [state, setState] = useState<ManagerState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [templateLabel, setTemplateLabel] = useState('')
  const [templateKey, setTemplateKey] = useState('')
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotDraft>>({})
  const [sourceProductId, setSourceProductId] = useState('')
  const [targetProductId, setTargetProductId] = useState('')
  const [relationKey, setRelationKey] = useState('')
  const [relationScore, setRelationScore] = useState('1')
  const [relationVerified, setRelationVerified] = useState(true)

  const activeProducts = useMemo(
    () => [...products]
      .filter((product) => product.is_active)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [products],
  )
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  )
  const offeringTypeNames = useMemo(
    () => new Map(state.offering_types.map((type) => [type.id, type.label])),
    [state.offering_types],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/compositions', { cache: 'no-store' })
      const data = await parseResponse(response)
      setState({
        templates: data.templates ?? [],
        relations: data.relations ?? [],
        offering_types: data.offering_types ?? [],
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as composições.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createTemplate() {
    const label = templateLabel.trim()
    const key = (templateKey.trim() || normalizeKey(label)).trim()
    if (!label || !key || saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'template', label, key }),
      }))
      setTemplateLabel('')
      setTemplateKey('')
      await load()
      toast.success('Template de composição criado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o template.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleTemplate(template: CompositionTemplate, enabled: boolean) {
    if (saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'template', id: template.id, enabled }),
      }))
      setState((current) => ({
        ...current,
        templates: current.templates.map((item) => item.id === template.id ? { ...item, enabled } : item),
      }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar o template.')
    } finally {
      setSaving(false)
    }
  }

  function slotDraft(templateId: string): SlotDraft {
    return slotDrafts[templateId] ?? EMPTY_SLOT_DRAFT
  }

  function setSlotDraft(templateId: string, patch: Partial<SlotDraft>) {
    setSlotDrafts((current) => ({
      ...current,
      [templateId]: { ...(current[templateId] ?? EMPTY_SLOT_DRAFT), ...patch },
    }))
  }

  async function createSlot(template: CompositionTemplate) {
    const draft = slotDraft(template.id)
    const label = draft.label.trim()
    const key = (draft.key.trim() || normalizeKey(label)).trim()
    if (!label || !key || saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'slot',
          template_id: template.id,
          label,
          key,
          required: draft.required,
          min_items: draft.required ? 1 : 0,
          max_items: 1,
          offering_type_ids: draft.offeringTypeId ? [draft.offeringTypeId] : [],
          sort_order: template.slots.length * 10,
        }),
      }))
      setSlotDrafts((current) => ({ ...current, [template.id]: { ...EMPTY_SLOT_DRAFT } }))
      await load()
      toast.success('Slot criado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o slot.')
    } finally {
      setSaving(false)
    }
  }

  async function createRelation() {
    const key = relationKey.trim() || 'related'
    if (!sourceProductId || !targetProductId || sourceProductId === targetProductId || saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'relation',
          source_product_id: sourceProductId,
          target_product_id: targetProductId,
          relation_key: normalizeKey(key),
          score: Number(relationScore),
          verified: relationVerified,
        }),
      }))
      setSourceProductId('')
      setTargetProductId('')
      setRelationKey('')
      setRelationScore('1')
      setRelationVerified(true)
      await load()
      toast.success('Relação criada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a relação.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRelation(relation: ProductRelation, verified: boolean) {
    if (saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'relation', id: relation.id, verified }),
      }))
      setState((current) => ({
        ...current,
        relations: current.relations.map((item) => item.id === relation.id ? { ...item, verified } : item),
      }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a relação.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(entity: 'template' | 'slot' | 'relation', id: string) {
    if (saving) return
    setSaving(true)
    try {
      await parseResponse(await fetch('/api/catalog/compositions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id }),
      }))
      await load()
      toast.success('Configuração removida.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível remover a configuração.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Layers3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Composições</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Defina soluções multi-oferta sem regras por sector. Os slots dizem o que a solução precisa; o grafo diz que ofertas combinam, são compatíveis ou se complementam.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates de solução</CardTitle>
          <CardDescription>
            Um template pode representar um conjunto, pacote, kit, configuração ou qualquer solução definida pela empresa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input
                value={templateLabel}
                onChange={(event) => {
                  const value = event.target.value
                  setTemplateLabel(value)
                  if (!templateKey) setTemplateKey(normalizeKey(value))
                }}
                placeholder="Nome do template, ex.: Solução completa"
              />
              <Input
                value={templateKey}
                onChange={(event) => setTemplateKey(normalizeKey(event.target.value))}
                placeholder="chave_do_template"
              />
              <Button onClick={() => void createTemplate()} disabled={saving || !templateLabel.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                Adicionar
              </Button>
            </div>
          )}

          {state.templates.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Ainda não existe nenhum template. O agente continuará a usar o catálogo normalmente até esta capacidade ser configurada e activada.
            </p>
          ) : (
            <div className="space-y-4">
              {state.templates.map((template) => {
                const draft = slotDraft(template.id)
                return (
                  <div key={template.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{template.label}</p>
                          <Badge variant={template.enabled ? 'default' : 'secondary'}>
                            {template.enabled ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{template.key}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={template.enabled}
                          disabled={!canEdit || saving}
                          onCheckedChange={(enabled) => void toggleTemplate(template, enabled)}
                          aria-label={`Activar ${template.label}`}
                        />
                        {canEdit && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => void remove('template', template.id)}
                            aria-label={`Remover ${template.label}`}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {template.slots.map((slot) => (
                        <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{slot.label}</span>
                              <Badge variant="outline">{slot.key}</Badge>
                              {slot.required && <Badge variant="secondary">Obrigatório</Badge>}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {slot.offering_type_ids.length
                                ? slot.offering_type_ids.map((id) => offeringTypeNames.get(id) ?? id).join(', ')
                                : 'Sem tipo fixo · preenchimento apenas através de relações do grafo'}
                            </p>
                          </div>
                          {canEdit && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={saving}
                              onClick={() => void remove('slot', slot.id)}
                              aria-label={`Remover slot ${slot.label}`}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {canEdit && (
                      <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto]">
                        <Input
                          value={draft.label}
                          onChange={(event) => {
                            const value = event.target.value
                            setSlotDraft(template.id, {
                              label: value,
                              ...(!draft.key ? { key: normalizeKey(value) } : {}),
                            })
                          }}
                          placeholder="Novo slot, ex.: Componente principal"
                        />
                        <Input
                          value={draft.key}
                          onChange={(event) => setSlotDraft(template.id, { key: normalizeKey(event.target.value) })}
                          placeholder="chave_do_slot"
                        />
                        <select
                          value={draft.offeringTypeId}
                          onChange={(event) => setSlotDraft(template.id, { offeringTypeId: event.target.value })}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          aria-label="Tipo de oferta do slot"
                        >
                          <option value="">Sem tipo fixo</option>
                          {state.offering_types.map((type) => (
                            <option key={type.id} value={type.id}>{type.label}</option>
                          ))}
                        </select>
                        <label className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm">
                          <Switch
                            checked={draft.required}
                            onCheckedChange={(required) => setSlotDraft(template.id, { required })}
                            aria-label="Slot obrigatório"
                          />
                          Obrigatório
                        </label>
                        <Button
                          variant="outline"
                          onClick={() => void createSlot(template)}
                          disabled={saving || !draft.label.trim()}
                        >
                          <Plus /> Slot
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Grafo de relações</CardTitle>
          </div>
          <CardDescription>
            Relações são factos explícitos entre ofertas. A chave é definida pela empresa; o motor usa o peso e a verificação para ordenar candidatos, sem inventar relações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (
            <div className="grid gap-2 xl:grid-cols-[1fr_1fr_0.8fr_110px_auto_auto]">
              <select
                value={sourceProductId}
                onChange={(event) => setSourceProductId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Oferta de origem"
              >
                <option value="">Oferta de origem</option>
                {activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
              <select
                value={targetProductId}
                onChange={(event) => setTargetProductId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Oferta relacionada"
              >
                <option value="">Oferta relacionada</option>
                {activeProducts.filter((product) => product.id !== sourceProductId).map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
              <Input
                value={relationKey}
                onChange={(event) => setRelationKey(normalizeKey(event.target.value))}
                placeholder="relação, ex.: compatible"
              />
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={relationScore}
                onChange={(event) => setRelationScore(event.target.value)}
                aria-label="Peso da relação"
              />
              <label className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm">
                <Switch
                  checked={relationVerified}
                  onCheckedChange={setRelationVerified}
                  aria-label="Relação verificada"
                />
                Verificada
              </label>
              <Button
                onClick={() => void createRelation()}
                disabled={saving || !sourceProductId || !targetProductId || sourceProductId === targetProductId}
              >
                <Plus /> Relação
              </Button>
            </div>
          )}

          {state.relations.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Ainda não há relações. Templates com tipos de oferta podem usar candidatos elegíveis como fallback; slots sem tipo fixo só serão preenchidos quando houver relações no grafo.
            </p>
          ) : (
            <div className="space-y-2">
              {state.relations.map((relation) => (
                <div key={relation.id} className="grid gap-3 rounded-lg border px-3 py-2 md:grid-cols-[1fr_auto_1fr_auto_auto] md:items-center">
                  <span className="truncate text-sm">{productNames.get(relation.source_product_id) ?? relation.source_product_id}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{relation.relation_key}</Badge>
                    <span className="text-xs text-muted-foreground">{Number(relation.score).toFixed(2)}</span>
                  </div>
                  <span className="truncate text-sm">{productNames.get(relation.target_product_id) ?? relation.target_product_id}</span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={relation.verified}
                      disabled={!canEdit || saving}
                      onCheckedChange={(verified) => void toggleRelation(relation, verified)}
                      aria-label="Relação verificada"
                    />
                    Verificada
                  </label>
                  {canEdit && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => void remove('relation', relation.id)}
                      aria-label="Remover relação"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { DatabaseZap, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Product } from './product-card'

type ValueType = 'text' | 'number' | 'boolean' | 'enum'

interface OfferingType {
  id: string
  key: string
  label: string
  description: string | null
  enabled: boolean
  sort_order: number
}

interface OfferingOption {
  value: string
  label?: string
  aliases?: string[]
  enabled?: boolean
}

interface OfferingDefinition {
  id: string
  offering_type_id: string | null
  key: string
  label: string
  value_type: ValueType
  unit: string | null
  is_filterable: boolean
  allow_multiple: boolean
  required: boolean
  options: OfferingOption[]
  enabled: boolean
  sort_order: number
}

interface OfferingValueRow {
  definition_id: string
  value: unknown
}

interface ProductOfferingPayload {
  product: { id: string; name: string; offering_type_id: string | null }
  types: OfferingType[]
  definitions: OfferingDefinition[]
  values: OfferingValueRow[]
}

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

function slugKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function parseEnumOptions(text: string): OfferingOption[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawValue, rawLabel, rawAliases] = line.split('|').map((part) => part.trim())
      const value = rawValue
      const label = rawLabel || rawValue
      const aliases = rawAliases
        ? rawAliases.split(',').map((alias) => alias.trim()).filter(Boolean)
        : []
      return { value, label, aliases }
    })
    .filter((option) => Boolean(option.value))
}

function scalarFromRow(row: OfferingValueRow): string | boolean {
  if (typeof row.value === 'boolean') return row.value
  if (typeof row.value === 'number') return String(row.value)
  return typeof row.value === 'string' ? row.value : ''
}

export function OfferingSchemaManager({ products }: { products: Product[] }) {
  const [types, setTypes] = useState<OfferingType[]>([])
  const [definitions, setDefinitions] = useState<OfferingDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [typeLabel, setTypeLabel] = useState('')
  const [typeKey, setTypeKey] = useState('')
  const [typeDescription, setTypeDescription] = useState('')

  const [definitionLabel, setDefinitionLabel] = useState('')
  const [definitionKey, setDefinitionKey] = useState('')
  const [definitionTypeId, setDefinitionTypeId] = useState('')
  const [definitionValueType, setDefinitionValueType] = useState<ValueType>('text')
  const [definitionUnit, setDefinitionUnit] = useState('')
  const [definitionOptions, setDefinitionOptions] = useState('')
  const [definitionRequired, setDefinitionRequired] = useState(false)
  const [definitionFilterable, setDefinitionFilterable] = useState(true)
  const [definitionMultiple, setDefinitionMultiple] = useState(false)

  const [selectedProductId, setSelectedProductId] = useState('')
  const [productOffering, setProductOffering] = useState<ProductOfferingPayload | null>(null)
  const [selectedOfferingTypeId, setSelectedOfferingTypeId] = useState('')
  const [attributeValues, setAttributeValues] = useState<Record<string, string | boolean>>({})
  const [loadingProduct, setLoadingProduct] = useState(false)

  const loadSchema = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/offering-schema', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar a estrutura de ofertas.')
      setTypes(body.types ?? [])
      setDefinitions(body.definitions ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar a estrutura de ofertas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSchema()
  }, [loadSchema])

  useEffect(() => {
    if (!selectedProductId) {
      setProductOffering(null)
      setSelectedOfferingTypeId('')
      setAttributeValues({})
      return
    }
    let cancelled = false
    async function loadProductOffering() {
      setLoadingProduct(true)
      try {
        const response = await fetch(`/api/catalog/products/${selectedProductId}/offering`, { cache: 'no-store' })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar os atributos da oferta.')
        if (cancelled) return
        const payload = body as ProductOfferingPayload
        setProductOffering(payload)
        setSelectedOfferingTypeId(payload.product.offering_type_id ?? '')
        const grouped = new Map<string, Array<string | boolean>>()
        for (const row of payload.values ?? []) {
          const current = grouped.get(row.definition_id) ?? []
          current.push(scalarFromRow(row))
          grouped.set(row.definition_id, current)
        }
        const next: Record<string, string | boolean> = {}
        for (const definition of payload.definitions ?? []) {
          const values = grouped.get(definition.id) ?? []
          if (definition.value_type === 'boolean') next[definition.id] = values[0] === true
          else if (definition.allow_multiple) next[definition.id] = values.map(String).join(', ')
          else next[definition.id] = values.length ? String(values[0]) : ''
        }
        setAttributeValues(next)
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Erro ao carregar a oferta.')
      } finally {
        if (!cancelled) setLoadingProduct(false)
      }
    }
    void loadProductOffering()
    return () => { cancelled = true }
  }, [selectedProductId])

  async function createType(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/catalog/offering-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'type',
          key: typeKey || slugKey(typeLabel),
          label: typeLabel,
          description: typeDescription,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar o tipo de oferta.')
      setTypeLabel('')
      setTypeKey('')
      setTypeDescription('')
      await loadSchema()
      toast.success('Tipo de oferta criado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar o tipo de oferta.')
    } finally {
      setSaving(false)
    }
  }

  async function createDefinition(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/catalog/offering-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'definition',
          key: definitionKey || slugKey(definitionLabel),
          label: definitionLabel,
          offering_type_id: definitionTypeId || null,
          value_type: definitionValueType,
          unit: definitionUnit || null,
          required: definitionRequired,
          is_filterable: definitionFilterable,
          allow_multiple: definitionMultiple,
          options: definitionValueType === 'enum' ? parseEnumOptions(definitionOptions) : [],
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar o atributo.')
      setDefinitionLabel('')
      setDefinitionKey('')
      setDefinitionUnit('')
      setDefinitionOptions('')
      setDefinitionRequired(false)
      setDefinitionMultiple(false)
      await loadSchema()
      toast.success('Atributo criado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar o atributo.')
    } finally {
      setSaving(false)
    }
  }

  async function patchSchema(entity: 'type' | 'definition', id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch('/api/catalog/offering-schema', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, ...patch }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível actualizar.')
      await loadSchema()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao actualizar.')
    }
  }

  async function deleteSchema(entity: 'type' | 'definition', id: string) {
    if (!confirm(entity === 'type' ? 'Eliminar este tipo de oferta?' : 'Eliminar este atributo?')) return
    try {
      const response = await fetch('/api/catalog/offering-schema', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível eliminar.')
      await loadSchema()
      toast.success('Registo eliminado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao eliminar.')
    }
  }

  const applicableDefinitions = useMemo(() => {
    const source = productOffering?.definitions ?? definitions
    return source.filter((definition) =>
      definition.enabled &&
      (definition.offering_type_id === null || definition.offering_type_id === (selectedOfferingTypeId || null)),
    )
  }, [definitions, productOffering, selectedOfferingTypeId])

  async function saveProductOffering() {
    if (!selectedProductId) return
    setSaving(true)
    try {
      const attributes: Record<string, unknown> = {}
      for (const definition of applicableDefinitions) {
        const raw = attributeValues[definition.id]
        if (definition.allow_multiple && typeof raw === 'string') {
          attributes[definition.id] = raw.split(',').map((value) => value.trim()).filter(Boolean)
        } else {
          attributes[definition.id] = raw
        }
      }
      const response = await fetch(`/api/catalog/products/${selectedProductId}/offering`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offering_type_id: selectedOfferingTypeId || null,
          attributes,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar a oferta.')
      toast.success('Estrutura e atributos da oferta guardados.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao guardar a oferta.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><DatabaseZap className="h-5 w-5 text-primary" /><CardTitle>Business Offering</CardTitle></div>
          <CardDescription>
            Defina tipos e atributos do negócio sem alterar o código do agente. O mesmo motor pode representar produtos, serviços, alugueres ou pacotes.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tipos de oferta</CardTitle>
            <CardDescription>Ex.: Produto, Serviço, Aluguer, Pacote. Os nomes pertencem à conta, não ao runtime.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={createType} className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Nome</Label><Input required value={typeLabel} onChange={(e) => { setTypeLabel(e.target.value); if (!typeKey) setTypeKey(slugKey(e.target.value)) }} placeholder="Produto" /></div>
                <div className="space-y-1.5"><Label>Chave</Label><Input required value={typeKey} onChange={(e) => setTypeKey(slugKey(e.target.value))} placeholder="produto" /></div>
              </div>
              <div className="space-y-1.5"><Label>Descrição</Label><Input value={typeDescription} onChange={(e) => setTypeDescription(e.target.value)} placeholder="Opcional" /></div>
              <Button type="submit" disabled={saving}><Plus />Criar tipo</Button>
            </form>
            <div className="space-y-2">
              {types.map((type) => (
                <div key={type.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0"><p className="font-medium">{type.label}</p><p className="text-xs text-muted-foreground">{type.key}{type.description ? ` · ${type.description}` : ''}</p></div>
                  <div className="flex items-center gap-2">
                    <Switch checked={type.enabled} onCheckedChange={(enabled) => void patchSchema('type', type.id, { enabled })} aria-label={`Activar ${type.label}`} />
                    <Button size="icon-sm" variant="ghost" onClick={() => void deleteSchema('type', type.id)}><Trash2 /></Button>
                  </div>
                </div>
              ))}
              {types.length === 0 && <p className="text-sm text-muted-foreground">Ainda não existem tipos de oferta.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atributos estruturados</CardTitle>
            <CardDescription>Factos que o agente pode filtrar deterministicamente, sem os inventar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={createDefinition} className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Nome</Label><Input required value={definitionLabel} onChange={(e) => { setDefinitionLabel(e.target.value); if (!definitionKey) setDefinitionKey(slugKey(e.target.value)) }} placeholder="Capacidade" /></div>
                <div className="space-y-1.5"><Label>Chave</Label><Input required value={definitionKey} onChange={(e) => setDefinitionKey(slugKey(e.target.value))} placeholder="capacidade" /></div>
                <div className="space-y-1.5"><Label>Aplica-se a</Label><select className={selectClass} value={definitionTypeId} onChange={(e) => setDefinitionTypeId(e.target.value)}><option value="">Todos os tipos</option>{types.filter((type) => type.enabled).map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></div>
                <div className="space-y-1.5"><Label>Tipo de valor</Label><select className={selectClass} value={definitionValueType} onChange={(e) => setDefinitionValueType(e.target.value as ValueType)}><option value="text">Texto</option><option value="number">Número</option><option value="boolean">Sim/Não</option><option value="enum">Opções</option></select></div>
                <div className="space-y-1.5"><Label>Unidade</Label><Input value={definitionUnit} onChange={(e) => setDefinitionUnit(e.target.value)} placeholder="pessoas, km, GB..." /></div>
              </div>
              {definitionValueType === 'enum' && (
                <div className="space-y-1.5"><Label>Opções</Label><Textarea rows={4} value={definitionOptions} onChange={(e) => setDefinitionOptions(e.target.value)} placeholder={'Uma por linha: valor|rótulo|alias1,alias2\nmanual|Manual|stick shift'} /></div>
              )}
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <label className="flex items-center gap-2"><Switch checked={definitionFilterable} onCheckedChange={setDefinitionFilterable} />Filtrável</label>
                <label className="flex items-center gap-2"><Switch checked={definitionRequired} onCheckedChange={setDefinitionRequired} />Obrigatório</label>
                <label className="flex items-center gap-2"><Switch checked={definitionMultiple} onCheckedChange={setDefinitionMultiple} />Múltiplos valores</label>
              </div>
              <Button type="submit" disabled={saving}><Plus />Criar atributo</Button>
            </form>
            <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {definitions.map((definition) => {
                const ownerType = types.find((type) => type.id === definition.offering_type_id)
                return <div key={definition.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium">{definition.label}</p><p className="text-xs text-muted-foreground">{definition.key} · {definition.value_type}{definition.unit ? ` · ${definition.unit}` : ''} · {ownerType?.label ?? 'Global'}</p></div>
                    <div className="flex items-center gap-2"><Switch checked={definition.enabled} onCheckedChange={(enabled) => void patchSchema('definition', definition.id, { enabled })} /><Button size="icon-sm" variant="ghost" onClick={() => void deleteSchema('definition', definition.id)}><Trash2 /></Button></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5"><Switch checked={definition.is_filterable} onCheckedChange={(is_filterable) => void patchSchema('definition', definition.id, { is_filterable })} />Filtrável</label>
                    <label className="flex items-center gap-1.5"><Switch checked={definition.required} onCheckedChange={(required) => void patchSchema('definition', definition.id, { required })} />Obrigatório</label>
                  </div>
                </div>
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Atributos por oferta</CardTitle>
          <CardDescription>Escolha um produto interno, associe o tipo de oferta e preencha apenas os campos definidos por esta empresa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Produto</Label><select className={selectClass} value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}><option value="">Seleccione...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div>
            <div className="space-y-1.5"><Label>Tipo de oferta</Label><select className={selectClass} value={selectedOfferingTypeId} disabled={!selectedProductId || loadingProduct} onChange={(e) => { setSelectedOfferingTypeId(e.target.value); setAttributeValues({}) }}><option value="">Sem tipo específico</option>{types.filter((type) => type.enabled).map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></div>
          </div>

          {loadingProduct && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />A carregar atributos...</div>}

          {selectedProductId && !loadingProduct && (
            <div className="grid gap-4 md:grid-cols-2">
              {applicableDefinitions.map((definition) => {
                const value = attributeValues[definition.id] ?? (definition.value_type === 'boolean' ? false : '')
                return <div key={definition.id} className="space-y-1.5">
                  <Label>{definition.label}{definition.required ? ' *' : ''}{definition.unit ? ` (${definition.unit})` : ''}</Label>
                  {definition.value_type === 'boolean' ? (
                    <div className="flex h-9 items-center gap-2"><Switch checked={value === true} onCheckedChange={(checked) => setAttributeValues((current) => ({ ...current, [definition.id]: checked }))} /><span className="text-sm text-muted-foreground">{value === true ? 'Sim' : 'Não'}</span></div>
                  ) : definition.value_type === 'enum' && !definition.allow_multiple ? (
                    <select className={selectClass} value={String(value)} onChange={(e) => setAttributeValues((current) => ({ ...current, [definition.id]: e.target.value }))}><option value="">Seleccione...</option>{(definition.options ?? []).filter((option) => option.enabled !== false).map((option) => <option key={option.value} value={option.value}>{option.label || option.value}</option>)}</select>
                  ) : (
                    <Input type={definition.value_type === 'number' ? 'number' : 'text'} value={String(value)} onChange={(e) => setAttributeValues((current) => ({ ...current, [definition.id]: e.target.value }))} placeholder={definition.allow_multiple ? 'Separe valores por vírgulas' : undefined} />
                  )}
                </div>
              })}
              {applicableDefinitions.length === 0 && <p className="text-sm text-muted-foreground md:col-span-2">Este tipo de oferta ainda não tem atributos configurados.</p>}
            </div>
          )}

          {selectedProductId && (
            <Button onClick={() => void saveProductOffering()} disabled={saving || loadingProduct}><Save />Guardar estrutura da oferta</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

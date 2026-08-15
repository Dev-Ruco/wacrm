import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type ValueType = 'text' | 'number' | 'boolean' | 'enum'

interface DefinitionRow {
  id: string
  offering_type_id: string | null
  key: string
  label: string
  value_type: ValueType
  allow_multiple: boolean
  required: boolean
  options: unknown
  enabled: boolean
}

function optionalId(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 80) throw new Error('Identificador inválido.')
  return value
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function optionValues(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const values = [item.value, item.label, ...(Array.isArray(item.aliases) ? item.aliases : [])]
    return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  })
}

function canonicalEnumValue(input: unknown, options: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const requested = normalize(input)
  if (!Array.isArray(options)) return null
  for (const raw of options) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const canonical = typeof item.value === 'string' ? item.value.trim() : ''
    if (!canonical || item.enabled === false) continue
    if (optionValues([item]).some((value) => normalize(value) === requested)) return canonical
  }
  return null
}

function scalarValue(definition: DefinitionRow, input: unknown): { value: unknown; valueKey: string } | null {
  if (input == null || input === '') return null
  if (definition.value_type === 'boolean') {
    if (typeof input !== 'boolean') throw new Error(`${definition.label}: valor booleano inválido.`)
    return { value: input, valueKey: input ? 'true' : 'false' }
  }
  if (definition.value_type === 'number') {
    const number = Number(input)
    if (!Number.isFinite(number)) throw new Error(`${definition.label}: número inválido.`)
    return { value: number, valueKey: String(number) }
  }
  if (definition.value_type === 'enum') {
    const canonical = canonicalEnumValue(input, definition.options)
    if (!canonical) throw new Error(`${definition.label}: opção inválida.`)
    return { value: canonical, valueKey: normalize(canonical) }
  }
  if (typeof input !== 'string') throw new Error(`${definition.label}: texto inválido.`)
  const cleaned = input.trim()
  if (!cleaned) return null
  if (cleaned.length > 1000) throw new Error(`${definition.label}: texto demasiado longo.`)
  return { value: cleaned, valueKey: normalize(cleaned).slice(0, 180) || 'value' }
}

function rowsForDefinition(
  accountId: string,
  productId: string,
  definition: DefinitionRow,
  input: unknown,
) {
  const rawValues = definition.allow_multiple && Array.isArray(input) ? input : [input]
  const unique = new Map<string, { value: unknown; valueKey: string }>()
  for (const raw of rawValues) {
    const parsed = scalarValue(definition, raw)
    if (parsed && !unique.has(parsed.valueKey)) unique.set(parsed.valueKey, parsed)
  }
  return Array.from(unique.values()).map((parsed) => ({
    account_id: accountId,
    product_id: productId,
    definition_id: definition.id,
    value_key: parsed.valueKey,
    value: parsed.value,
    source: 'manual',
    confidence: 1,
    verified: true,
  }))
}

async function loadProduct(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from('catalog_products')
    .select('id, name, offering_type_id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const product = await loadProduct(supabase, accountId, id)
    if (!product) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })

    const [typesResult, definitionsResult, valuesResult] = await Promise.all([
      supabase.from('offering_types').select('*').eq('account_id', accountId).eq('enabled', true).order('sort_order'),
      supabase.from('offering_attribute_definitions').select('*').eq('account_id', accountId).eq('enabled', true).order('sort_order'),
      supabase.from('offering_attribute_values').select('*').eq('account_id', accountId).eq('product_id', id),
    ])
    if (typesResult.error) throw typesResult.error
    if (definitionsResult.error) throw definitionsResult.error
    if (valuesResult.error) throw valuesResult.error

    return NextResponse.json({
      product,
      types: typesResult.data ?? [],
      definitions: definitionsResult.data ?? [],
      values: valuesResult.data ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const product = await loadProduct(supabase, accountId, id)
    if (!product) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const offeringTypeId = optionalId(input.offering_type_id)
    const attributes = input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes)
      ? input.attributes as Record<string, unknown>
      : {}

    if (offeringTypeId) {
      const { data: typeRow, error: typeError } = await supabase
        .from('offering_types')
        .select('id')
        .eq('id', offeringTypeId)
        .eq('account_id', accountId)
        .eq('enabled', true)
        .maybeSingle()
      if (typeError) throw typeError
      if (!typeRow) return NextResponse.json({ error: 'Tipo de oferta inválido.' }, { status: 400 })
    }

    const { data: definitionRows, error: definitionError } = await supabase
      .from('offering_attribute_definitions')
      .select('id, offering_type_id, key, label, value_type, allow_multiple, required, options, enabled')
      .eq('account_id', accountId)
      .eq('enabled', true)
    if (definitionError) throw definitionError

    const applicable = ((definitionRows ?? []) as DefinitionRow[]).filter((definition) =>
      definition.offering_type_id === null || definition.offering_type_id === offeringTypeId,
    )
    const applicableIds = new Set(applicable.map((definition) => definition.id))
    const unknownDefinition = Object.keys(attributes).find((definitionId) => !applicableIds.has(definitionId))
    if (unknownDefinition) {
      return NextResponse.json({ error: 'Foi enviado um atributo que não pertence ao tipo de oferta seleccionado.' }, { status: 400 })
    }

    const rows = applicable.flatMap((definition) =>
      rowsForDefinition(accountId, id, definition, attributes[definition.id]),
    )
    const presentDefinitionIds = new Set(rows.map((row) => row.definition_id))
    const missingRequired = applicable.find((definition) => definition.required && !presentDefinitionIds.has(definition.id))
    if (missingRequired) {
      return NextResponse.json({ error: `${missingRequired.label} é obrigatório.` }, { status: 400 })
    }

    const { error: productError } = await supabase
      .from('catalog_products')
      .update({ offering_type_id: offeringTypeId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId)
    if (productError) throw productError

    const { error: deleteError } = await supabase
      .from('offering_attribute_values')
      .delete()
      .eq('account_id', accountId)
      .eq('product_id', id)
    if (deleteError) throw deleteError

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('offering_attribute_values')
        .insert(rows)
      if (insertError) throw insertError
    }

    return NextResponse.json({
      ok: true,
      offering_type_id: offeringTypeId,
      values: rows,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

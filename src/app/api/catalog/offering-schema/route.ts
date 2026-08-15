import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Entity = 'type' | 'definition'
type ValueType = 'text' | 'number' | 'boolean' | 'enum'

function text(value: unknown, max = 200): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

function key(value: unknown): string | null {
  const cleaned = text(value, 80)?.toLowerCase() ?? null
  if (!cleaned) return null
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(cleaned)) {
    throw new Error('A chave deve começar por uma letra e usar apenas letras minúsculas, números e _.')
  }
  return cleaned
}

function entity(value: unknown): Entity | null {
  return value === 'type' || value === 'definition' ? value : null
}

function valueType(value: unknown): ValueType | null {
  return value === 'text' || value === 'number' || value === 'boolean' || value === 'enum'
    ? value
    : null
}

function options(value: unknown): Array<Record<string, unknown>> {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('options deve ser uma lista.')
  const seen = new Set<string>()
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const optionValue = text(item.value, 120)
    const label = text(item.label, 120) ?? optionValue
    if (!optionValue || !label) return []
    const normalized = optionValue.toLowerCase()
    if (seen.has(normalized)) return []
    seen.add(normalized)
    const aliases = Array.isArray(item.aliases)
      ? item.aliases
          .map((alias) => text(alias, 120))
          .filter((alias): alias is string => Boolean(alias))
      : []
    return [{
      value: optionValue,
      label,
      aliases,
      enabled: item.enabled !== false,
      sort_order: typeof item.sort_order === 'number' ? item.sort_order : index,
    }]
  })
}

async function ensureOfferingType(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  offeringTypeId: string | null,
) {
  if (!offeringTypeId) return
  const { data, error } = await supabase
    .from('offering_types')
    .select('id')
    .eq('id', offeringTypeId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Tipo de oferta inválido para esta conta.')
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [typesResult, definitionsResult] = await Promise.all([
      supabase
        .from('offering_types')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true }),
      supabase
        .from('offering_attribute_definitions')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true }),
    ])
    if (typesResult.error) throw typesResult.error
    if (definitionsResult.error) throw definitionsResult.error
    return NextResponse.json({
      types: typesResult.data ?? [],
      definitions: definitionsResult.data ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const target = entity(input.entity)
    if (!target) return NextResponse.json({ error: 'entity inválida.' }, { status: 400 })

    if (target === 'type') {
      const typeKey = key(input.key)
      const label = text(input.label, 120)
      if (!typeKey || !label) return NextResponse.json({ error: 'key e label são obrigatórios.' }, { status: 400 })
      const { data, error } = await supabase
        .from('offering_types')
        .insert({
          account_id: accountId,
          key: typeKey,
          label,
          description: text(input.description, 1000),
          enabled: input.enabled !== false,
          sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
        })
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ item: data }, { status: 201 })
    }

    const definitionKey = key(input.key)
    const label = text(input.label, 120)
    const kind = valueType(input.value_type)
    const offeringTypeId = text(input.offering_type_id, 80)
    if (!definitionKey || !label || !kind) {
      return NextResponse.json({ error: 'key, label e value_type são obrigatórios.' }, { status: 400 })
    }
    await ensureOfferingType(supabase, accountId, offeringTypeId)
    const enumOptions = kind === 'enum' ? options(input.options) : []
    if (kind === 'enum' && enumOptions.length === 0) {
      return NextResponse.json({ error: 'Um atributo enum precisa de pelo menos uma opção.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('offering_attribute_definitions')
      .insert({
        account_id: accountId,
        offering_type_id: offeringTypeId,
        key: definitionKey,
        label,
        value_type: kind,
        unit: text(input.unit, 40),
        is_filterable: input.is_filterable !== false,
        allow_multiple: input.allow_multiple === true,
        required: input.required === true,
        options: enumOptions,
        enabled: input.enabled !== false,
        sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
      })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ item: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const target = entity(input.entity)
    const id = text(input.id, 80)
    if (!target || !id) return NextResponse.json({ error: 'entity e id são obrigatórios.' }, { status: 400 })

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('label' in input) {
      const label = text(input.label, 120)
      if (!label) return NextResponse.json({ error: 'label não pode ficar vazio.' }, { status: 400 })
      update.label = label
    }
    if ('description' in input && target === 'type') update.description = text(input.description, 1000)
    if ('enabled' in input) update.enabled = input.enabled === true
    if ('sort_order' in input && Number.isFinite(Number(input.sort_order))) update.sort_order = Number(input.sort_order)

    if (target === 'definition') {
      if ('offering_type_id' in input) {
        const offeringTypeId = text(input.offering_type_id, 80)
        await ensureOfferingType(supabase, accountId, offeringTypeId)
        update.offering_type_id = offeringTypeId
      }
      if ('unit' in input) update.unit = text(input.unit, 40)
      if ('is_filterable' in input) update.is_filterable = input.is_filterable === true
      if ('allow_multiple' in input) update.allow_multiple = input.allow_multiple === true
      if ('required' in input) update.required = input.required === true
      if ('options' in input) update.options = options(input.options)
    }

    const table = target === 'type' ? 'offering_types' : 'offering_attribute_definitions'
    const { data, error } = await supabase
      .from(table)
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ item: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const target = entity(input.entity)
    const id = text(input.id, 80)
    if (!target || !id) return NextResponse.json({ error: 'entity e id são obrigatórios.' }, { status: 400 })

    const table = target === 'type' ? 'offering_types' : 'offering_attribute_definitions'
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

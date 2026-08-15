import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Entity = 'template' | 'slot' | 'relation'

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
  return value === 'template' || value === 'slot' || value === 'relation' ? value : null
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function unitInterval(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function uuidList(value: unknown, maxItems = 20): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('offering_type_ids deve ser uma lista.')
  const result = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  if (result.length !== value.length) throw new Error('offering_type_ids contém um valor inválido.')
  return Array.from(new Set(result)).slice(0, maxItems)
}

async function ensureTemplate(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from('composition_templates')
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Template inválido para esta conta.')
}

async function ensureSlot(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from('composition_slots')
    .select('id, template_id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Slot inválido para esta conta.')
  return data
}

async function ensureOfferingTypes(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  ids: string[],
) {
  if (!ids.length) return
  const { data, error } = await supabase
    .from('offering_types')
    .select('id')
    .eq('account_id', accountId)
    .in('id', ids)
  if (error) throw error
  if ((data ?? []).length !== ids.length) throw new Error('Um ou mais tipos de oferta são inválidos para esta conta.')
}

async function ensureProducts(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  ids: string[],
) {
  const uniqueIds = Array.from(new Set(ids))
  const { data, error } = await supabase
    .from('catalog_products')
    .select('id')
    .eq('account_id', accountId)
    .in('id', uniqueIds)
  if (error) throw error
  if ((data ?? []).length !== uniqueIds.length) throw new Error('Um ou mais produtos são inválidos para esta conta.')
}

async function replaceSlotOfferingTypes(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  slotId: string,
  offeringTypeIds: string[],
) {
  await ensureOfferingTypes(supabase, accountId, offeringTypeIds)
  const { error: deleteError } = await supabase
    .from('composition_slot_offering_types')
    .delete()
    .eq('account_id', accountId)
    .eq('slot_id', slotId)
  if (deleteError) throw deleteError
  if (!offeringTypeIds.length) return
  const { error: insertError } = await supabase
    .from('composition_slot_offering_types')
    .insert(offeringTypeIds.map((offeringTypeId) => ({
      account_id: accountId,
      slot_id: slotId,
      offering_type_id: offeringTypeId,
    })))
  if (insertError) throw insertError
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [templatesResult, slotsResult, slotTypesResult, relationsResult, offeringTypesResult] = await Promise.all([
      supabase
        .from('composition_templates')
        .select('id, key, label, description, enabled, sort_order, created_at, updated_at')
        .eq('account_id', accountId)
        .order('sort_order')
        .order('label'),
      supabase
        .from('composition_slots')
        .select('id, template_id, key, label, description, required, min_items, max_items, sort_order')
        .eq('account_id', accountId)
        .order('sort_order')
        .order('label'),
      supabase
        .from('composition_slot_offering_types')
        .select('slot_id, offering_type_id')
        .eq('account_id', accountId),
      supabase
        .from('catalog_product_relations')
        .select('id, source_product_id, target_product_id, relation_key, score, source, confidence, verified, updated_at')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(500),
      supabase
        .from('offering_types')
        .select('id, key, label, enabled')
        .eq('account_id', accountId)
        .eq('enabled', true)
        .order('sort_order')
        .order('label'),
    ])
    if (templatesResult.error) throw templatesResult.error
    if (slotsResult.error) throw slotsResult.error
    if (slotTypesResult.error) throw slotTypesResult.error
    if (relationsResult.error) throw relationsResult.error
    if (offeringTypesResult.error) throw offeringTypesResult.error

    const typeIdsBySlot = new Map<string, string[]>()
    for (const row of slotTypesResult.data ?? []) {
      const slotId = String(row.slot_id)
      typeIdsBySlot.set(slotId, [...(typeIdsBySlot.get(slotId) ?? []), String(row.offering_type_id)])
    }
    const slotsByTemplate = new Map<string, Array<Record<string, unknown>>>()
    for (const row of slotsResult.data ?? []) {
      const templateId = String(row.template_id)
      const slot = { ...row, offering_type_ids: typeIdsBySlot.get(String(row.id)) ?? [] }
      slotsByTemplate.set(templateId, [...(slotsByTemplate.get(templateId) ?? []), slot])
    }

    return NextResponse.json({
      templates: (templatesResult.data ?? []).map((template) => ({
        ...template,
        slots: slotsByTemplate.get(String(template.id)) ?? [],
      })),
      relations: relationsResult.data ?? [],
      offering_types: offeringTypesResult.data ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const target = entity(input.entity)
    if (!target) return NextResponse.json({ error: 'entity inválida.' }, { status: 400 })

    if (target === 'template') {
      const templateKey = key(input.key)
      const label = text(input.label, 120)
      if (!templateKey || !label) return NextResponse.json({ error: 'key e label são obrigatórios.' }, { status: 400 })
      const { data, error } = await supabase
        .from('composition_templates')
        .insert({
          account_id: accountId,
          key: templateKey,
          label,
          description: text(input.description, 1000),
          enabled: input.enabled !== false,
          sort_order: integer(input.sort_order, 0, -10000, 10000),
        })
        .select('id, key, label, description, enabled, sort_order')
        .single()
      if (error) throw error
      return NextResponse.json({ item: { ...data, slots: [] } }, { status: 201 })
    }

    if (target === 'slot') {
      const templateId = text(input.template_id, 80)
      const slotKey = key(input.key)
      const label = text(input.label, 120)
      if (!templateId || !slotKey || !label) {
        return NextResponse.json({ error: 'template_id, key e label são obrigatórios.' }, { status: 400 })
      }
      await ensureTemplate(supabase, accountId, templateId)
      const required = input.required !== false
      const minItems = integer(input.min_items, required ? 1 : 0, 0, 20)
      const maxItems = integer(input.max_items, Math.max(1, minItems), 1, 20)
      if (maxItems < minItems) return NextResponse.json({ error: 'max_items deve ser maior ou igual a min_items.' }, { status: 400 })
      const offeringTypeIds = uuidList(input.offering_type_ids)
      await ensureOfferingTypes(supabase, accountId, offeringTypeIds)

      const { data, error } = await supabase
        .from('composition_slots')
        .insert({
          account_id: accountId,
          template_id: templateId,
          key: slotKey,
          label,
          description: text(input.description, 1000),
          required,
          min_items: minItems,
          max_items: maxItems,
          sort_order: integer(input.sort_order, 0, -10000, 10000),
        })
        .select('id, template_id, key, label, description, required, min_items, max_items, sort_order')
        .single()
      if (error) throw error
      try {
        await replaceSlotOfferingTypes(supabase, accountId, data.id, offeringTypeIds)
      } catch (error) {
        await supabase.from('composition_slots').delete().eq('id', data.id).eq('account_id', accountId)
        throw error
      }
      return NextResponse.json({ item: { ...data, offering_type_ids: offeringTypeIds } }, { status: 201 })
    }

    const sourceProductId = text(input.source_product_id, 80)
    const targetProductId = text(input.target_product_id, 80)
    const relationKey = key(input.relation_key)
    if (!sourceProductId || !targetProductId || !relationKey) {
      return NextResponse.json({ error: 'source_product_id, target_product_id e relation_key são obrigatórios.' }, { status: 400 })
    }
    if (sourceProductId === targetProductId) {
      return NextResponse.json({ error: 'Uma relação precisa de dois produtos diferentes.' }, { status: 400 })
    }
    await ensureProducts(supabase, accountId, [sourceProductId, targetProductId])
    const confidence = input.confidence == null || input.confidence === '' ? null : unitInterval(input.confidence, 0)
    const { data, error } = await supabase
      .from('catalog_product_relations')
      .insert({
        account_id: accountId,
        source_product_id: sourceProductId,
        target_product_id: targetProductId,
        relation_key: relationKey,
        score: unitInterval(input.score, 1),
        source: 'manual',
        confidence,
        verified: input.verified === true,
      })
      .select('id, source_product_id, target_product_id, relation_key, score, source, confidence, verified, updated_at')
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

    if (target === 'template') {
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('label' in input) {
        const label = text(input.label, 120)
        if (!label) return NextResponse.json({ error: 'label não pode ficar vazio.' }, { status: 400 })
        update.label = label
      }
      if ('description' in input) update.description = text(input.description, 1000)
      if ('enabled' in input) update.enabled = input.enabled === true
      if ('sort_order' in input) update.sort_order = integer(input.sort_order, 0, -10000, 10000)
      const { data, error } = await supabase
        .from('composition_templates')
        .update(update)
        .eq('id', id)
        .eq('account_id', accountId)
        .select('id, key, label, description, enabled, sort_order')
        .single()
      if (error) throw error
      return NextResponse.json({ item: data })
    }

    if (target === 'slot') {
      await ensureSlot(supabase, accountId, id)
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('label' in input) {
        const label = text(input.label, 120)
        if (!label) return NextResponse.json({ error: 'label não pode ficar vazio.' }, { status: 400 })
        update.label = label
      }
      if ('description' in input) update.description = text(input.description, 1000)
      if ('required' in input) update.required = input.required === true
      if ('min_items' in input) update.min_items = integer(input.min_items, 0, 0, 20)
      if ('max_items' in input) update.max_items = integer(input.max_items, 1, 1, 20)
      if ('sort_order' in input) update.sort_order = integer(input.sort_order, 0, -10000, 10000)
      if ('min_items' in input || 'max_items' in input) {
        const currentResult = await supabase
          .from('composition_slots')
          .select('min_items, max_items')
          .eq('id', id)
          .eq('account_id', accountId)
          .single()
        if (currentResult.error) throw currentResult.error
        const minItems = 'min_items' in update ? Number(update.min_items) : Number(currentResult.data.min_items)
        const maxItems = 'max_items' in update ? Number(update.max_items) : Number(currentResult.data.max_items)
        if (maxItems < minItems) return NextResponse.json({ error: 'max_items deve ser maior ou igual a min_items.' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('composition_slots')
        .update(update)
        .eq('id', id)
        .eq('account_id', accountId)
        .select('id, template_id, key, label, description, required, min_items, max_items, sort_order')
        .single()
      if (error) throw error
      let offeringTypeIds: string[] | undefined
      if ('offering_type_ids' in input) {
        offeringTypeIds = uuidList(input.offering_type_ids)
        await replaceSlotOfferingTypes(supabase, accountId, id, offeringTypeIds)
      }
      return NextResponse.json({ item: { ...data, ...(offeringTypeIds ? { offering_type_ids: offeringTypeIds } : {}) } })
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('relation_key' in input) {
      const relationKey = key(input.relation_key)
      if (!relationKey) return NextResponse.json({ error: 'relation_key não pode ficar vazio.' }, { status: 400 })
      update.relation_key = relationKey
    }
    if ('score' in input) update.score = unitInterval(input.score, 1)
    if ('confidence' in input) update.confidence = input.confidence == null || input.confidence === '' ? null : unitInterval(input.confidence, 0)
    if ('verified' in input) update.verified = input.verified === true
    const { data, error } = await supabase
      .from('catalog_product_relations')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, source_product_id, target_product_id, relation_key, score, source, confidence, verified, updated_at')
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
    const table = target === 'template'
      ? 'composition_templates'
      : target === 'slot'
        ? 'composition_slots'
        : 'catalog_product_relations'
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

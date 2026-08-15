import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type EntityKind = 'entity_type' | 'entity' | 'link' | 'window' | 'exception'

function kind(value: unknown): EntityKind | null {
  return value === 'entity_type' || value === 'entity' || value === 'link' || value === 'window' || value === 'exception'
    ? value
    : null
}

function text(value: unknown, max = 180): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Esperava um valor de texto.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('O texto é demasiado longo.')
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

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function optionalInteger(value: unknown, min: number, max: number): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error('Valor numérico inválido.')
  return Math.floor(parsed)
}

function time(value: unknown): string | null {
  const cleaned = text(value, 12)
  if (!cleaned) return null
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(cleaned)) throw new Error('Hora inválida.')
  return cleaned.length === 5 ? `${cleaned}:00` : cleaned
}

function dateOnly(value: unknown): string | null {
  const cleaned = text(value, 10)
  if (!cleaned) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) throw new Error('Data inválida.')
  const parsed = new Date(`${cleaned}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Data inválida.')
  return cleaned
}

function isoDateTime(value: unknown): string | null {
  const cleaned = text(value, 50)
  if (!cleaned) return null
  const parsed = new Date(cleaned)
  if (Number.isNaN(parsed.getTime())) throw new Error('Data/hora inválida.')
  return parsed.toISOString()
}

function timeZone(value: unknown): string {
  const cleaned = text(value, 80) ?? 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: cleaned }).format(new Date())
  } catch {
    throw new Error('Timezone IANA inválido.')
  }
  return cleaned
}

async function ensureRow(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  table: string,
  accountId: string,
  id: string,
  label: string,
) {
  const { data, error } = await supabase.from(table).select('id').eq('account_id', accountId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`${label} inválido para esta conta.`)
}

async function ensureTargets(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  offeringId: string | null,
  entityId: string | null,
) {
  if (!offeringId && !entityId) throw new Error('Indique pelo menos uma oferta ou entidade.')
  if (offeringId) await ensureRow(supabase, 'catalog_products', accountId, offeringId, 'Oferta')
  if (entityId) await ensureRow(supabase, 'business_entities', accountId, entityId, 'Entidade')
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [types, entities, links, windows, exceptions, offerings] = await Promise.all([
      supabase.from('business_entity_types')
        .select('id, key, label, description, enabled, sort_order')
        .eq('account_id', accountId).order('sort_order').order('label'),
      supabase.from('business_entities')
        .select('id, entity_type_id, name, external_ref, enabled, metadata')
        .eq('account_id', accountId).order('name'),
      supabase.from('offering_entity_links')
        .select('id, offering_id, entity_id, relation_key, priority, enabled')
        .eq('account_id', accountId).order('priority', { ascending: false }),
      supabase.from('availability_windows')
        .select('id, offering_id, entity_id, weekday, start_time, end_time, timezone, capacity, valid_from, valid_until, enabled')
        .eq('account_id', accountId).order('weekday').order('start_time'),
      supabase.from('availability_exceptions')
        .select('id, offering_id, entity_id, starts_at, ends_at, status, capacity, reason, enabled')
        .eq('account_id', accountId).order('starts_at', { ascending: false }).limit(300),
      supabase.from('catalog_products')
        .select('id, name, offering_type_id, is_active')
        .eq('account_id', accountId).order('name').limit(1000),
    ])
    for (const result of [types, entities, links, windows, exceptions, offerings]) {
      if (result.error) throw result.error
    }
    return NextResponse.json({
      entity_types: types.data ?? [],
      entities: entities.data ?? [],
      links: links.data ?? [],
      windows: windows.data ?? [],
      exceptions: exceptions.data ?? [],
      offerings: offerings.data ?? [],
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
    const target = kind(input.entity)
    if (!target) return NextResponse.json({ error: 'entity inválida.' }, { status: 400 })

    if (target === 'entity_type') {
      const typeKey = key(input.key)
      const label = text(input.label, 120)
      if (!typeKey || !label) return NextResponse.json({ error: 'key e label são obrigatórios.' }, { status: 400 })
      const { data, error } = await supabase.from('business_entity_types').insert({
        account_id: accountId,
        key: typeKey,
        label,
        description: text(input.description, 1000),
        sort_order: integer(input.sort_order, 0, -10000, 10000),
      }).select('id, key, label, description, enabled, sort_order').single()
      if (error) throw error
      return NextResponse.json({ item: data }, { status: 201 })
    }

    if (target === 'entity') {
      const entityTypeId = text(input.entity_type_id, 80)
      const name = text(input.name, 180)
      if (!entityTypeId || !name) return NextResponse.json({ error: 'entity_type_id e name são obrigatórios.' }, { status: 400 })
      await ensureRow(supabase, 'business_entity_types', accountId, entityTypeId, 'Tipo de entidade')
      const { data, error } = await supabase.from('business_entities').insert({
        account_id: accountId,
        entity_type_id: entityTypeId,
        name,
        external_ref: text(input.external_ref, 180),
      }).select('id, entity_type_id, name, external_ref, enabled, metadata').single()
      if (error) throw error
      return NextResponse.json({ item: data }, { status: 201 })
    }

    if (target === 'link') {
      const offeringId = text(input.offering_id, 80)
      const entityId = text(input.entity_id, 80)
      const relationKey = key(input.relation_key)
      if (!offeringId || !entityId || !relationKey) return NextResponse.json({ error: 'offering_id, entity_id e relation_key são obrigatórios.' }, { status: 400 })
      await ensureTargets(supabase, accountId, offeringId, entityId)
      const { data, error } = await supabase.from('offering_entity_links').insert({
        account_id: accountId,
        offering_id: offeringId,
        entity_id: entityId,
        relation_key: relationKey,
        priority: integer(input.priority, 0, -10000, 10000),
      }).select('id, offering_id, entity_id, relation_key, priority, enabled').single()
      if (error) throw error
      return NextResponse.json({ item: data }, { status: 201 })
    }

    if (target === 'window') {
      const offeringId = text(input.offering_id, 80)
      const entityId = text(input.entity_id, 80)
      await ensureTargets(supabase, accountId, offeringId, entityId)
      const weekday = integer(input.weekday, -1, 0, 6)
      if (weekday < 0) return NextResponse.json({ error: 'weekday é obrigatório.' }, { status: 400 })
      const startTime = time(input.start_time)
      const endTime = time(input.end_time)
      if (!startTime || !endTime || endTime <= startTime) return NextResponse.json({ error: 'Intervalo de horas inválido.' }, { status: 400 })
      const validFrom = dateOnly(input.valid_from)
      const validUntil = dateOnly(input.valid_until)
      if (validFrom && validUntil && validUntil < validFrom) return NextResponse.json({ error: 'valid_until não pode anteceder valid_from.' }, { status: 400 })
      const { data, error } = await supabase.from('availability_windows').insert({
        account_id: accountId,
        offering_id: offeringId,
        entity_id: entityId,
        weekday,
        start_time: startTime,
        end_time: endTime,
        timezone: timeZone(input.timezone),
        capacity: optionalInteger(input.capacity, 1, 1_000_000),
        valid_from: validFrom,
        valid_until: validUntil,
      }).select('id, offering_id, entity_id, weekday, start_time, end_time, timezone, capacity, valid_from, valid_until, enabled').single()
      if (error) throw error
      return NextResponse.json({ item: data }, { status: 201 })
    }

    const offeringId = text(input.offering_id, 80)
    const entityId = text(input.entity_id, 80)
    await ensureTargets(supabase, accountId, offeringId, entityId)
    const startsAt = isoDateTime(input.starts_at)
    const endsAt = isoDateTime(input.ends_at)
    if (!startsAt || !endsAt || endsAt <= startsAt) return NextResponse.json({ error: 'Intervalo da excepção inválido.' }, { status: 400 })
    const status = input.status === 'available' || input.status === 'unavailable' ? input.status : null
    if (!status) return NextResponse.json({ error: 'status deve ser available ou unavailable.' }, { status: 400 })
    const { data, error } = await supabase.from('availability_exceptions').insert({
      account_id: accountId,
      offering_id: offeringId,
      entity_id: entityId,
      starts_at: startsAt,
      ends_at: endsAt,
      status,
      capacity: optionalInteger(input.capacity, 1, 1_000_000),
      reason: text(input.reason, 500),
    }).select('id, offering_id, entity_id, starts_at, ends_at, status, capacity, reason, enabled').single()
    if (error) throw error
    return NextResponse.json({ item: data }, { status: 201 })
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
    const target = kind(input.entity)
    const id = text(input.id, 80)
    if (!target || !id) return NextResponse.json({ error: 'entity e id são obrigatórios.' }, { status: 400 })
    const table = target === 'entity_type'
      ? 'business_entity_types'
      : target === 'entity'
        ? 'business_entities'
        : target === 'link'
          ? 'offering_entity_links'
          : target === 'window'
            ? 'availability_windows'
            : 'availability_exceptions'
    const { error } = await supabase.from(table).delete().eq('account_id', accountId).eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

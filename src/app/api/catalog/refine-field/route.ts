import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { loadCatalogTaxonomy } from '@/lib/catalog/taxonomy'

export type CatalogEditorialField = 'name' | 'category' | 'color' | 'description'

const EDITORIAL_FIELDS = new Set<CatalogEditorialField>([
  'name',
  'category',
  'color',
  'description',
])

function cleanInput(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanModelValue(value: string, max: number): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^['“”"]+|['“”"]+$/g, '')
    .trim()
    .slice(0, max)
}

export function parseFieldRefinement(raw: string, max = 4000): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>
      if (typeof parsed.value === 'string') return cleanModelValue(parsed.value, max)
    } catch {
      // Fall back to plain text when a provider does not follow the JSON request.
    }
  }
  return cleanModelValue(trimmed, max)
}

export function buildFieldRefinementPrompt(
  field: CatalogEditorialField,
  knownCategories: string[] = [],
  knownColors: string[] = [],
): string {
  const categoryGuidance = knownCategories.length
    ? `Configured categories for this business: ${knownCategories.join(', ')}.`
    : 'No fixed category vocabulary is configured; use a short reusable commercial category only when needed.'
  const colorGuidance = knownColors.length
    ? `Configured colours for this business: ${knownColors.join(', ')}.`
    : 'No fixed colour vocabulary is configured; use a concise natural commercial colour only when supported.'

  const fieldInstruction: Record<CatalogEditorialField, string> = {
    name: [
      'Rewrite ONLY the commercial product name.',
      'Improve spelling, grammar, capitalization and retail clarity while preserving the product identity in the latest human draft.',
      'Prefer a concise natural commercial title, usually 3-9 words.',
      'Do not invent brand, model, material, size, technical specification or any fact not supported by the supplied context/image.',
    ].join(' '),
    category: [
      'Return ONLY the best category for this item.',
      categoryGuidance,
      'Prefer an existing configured category when it genuinely matches; never force a mismatch.',
      'Keep the category reusable across similar catalogue items rather than copying the full product name.',
    ].join(' '),
    color: [
      'Return ONLY the commercially useful colour for this item.',
      colorGuidance,
      'Use the latest human draft and, when supplied, the image. Do not invent a colour when it is uncertain.',
    ].join(' '),
    description: [
      'Rewrite ONLY the commercial description.',
      'Treat the CURRENT NAME in the supplied context as the latest human decision and make the description fully consistent with it.',
      'Use current category and colour as supporting context.',
      'Write 2-4 concise natural Portuguese sentences that explain what the item is, useful visible/supported differentiators and ordinary use when reasonably inferable.',
      'Do not invent technical performance, material, dimensions, size, brand, model, certification or other unsupported facts.',
    ].join(' '),
  }

  return [
    'You are a senior ecommerce catalogue editor.',
    'The user is editing one product and explicitly asked you to improve exactly ONE editorial field. Never modify or return any other field.',
    'Return ONLY valid JSON in the exact shape {"value":"..."}. Do not add explanations, markdown or extra keys.',
    fieldInstruction[field],
    'ABSOLUTE PRICE LOCK: price, currency, stock, SKU, availability and other operational/commercial facts are outside this task. Never infer, suggest, calculate, mention, correct or return them, even if visible in an image.',
    'The latest values supplied by the user override older wording. Preserve facts; improve presentation only.',
  ].join(' ')
}

/**
 * POST /api/catalog/refine-field
 *
 * Refines exactly one editable catalogue field. The request contract contains
 * editorial context only; price, currency, stock and other operational facts
 * never enter the model prompt and can never be returned by this route.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const field = body?.field as CatalogEditorialField | undefined

    if (!field || !EDITORIAL_FIELDS.has(field)) {
      return NextResponse.json({ error: 'Campo editorial inválido.' }, { status: 400 })
    }

    const name = cleanInput(body?.name, 200)
    const category = cleanInput(body?.category, 200)
    const color = cleanInput(body?.color, 100)
    const description = cleanInput(body?.description, 4000)
    const imageUrl = cleanInput(body?.image_url, 2000)

    if (!name && !category && !color && !description && !imageUrl) {
      return NextResponse.json({ error: 'Forneça contexto do produto para usar a IA.' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA para poder melhorar campos do catálogo.' },
        { status: 409 },
      )
    }

    const taxonomy = await loadCatalogTaxonomy(db, accountId)
    const knownCategories = taxonomy.categoryGroups.map((group) => group[0]).filter(Boolean)
    const knownColors = taxonomy.colorGroups.map((group) => group[0]).filter(Boolean)

    const editorialContext = {
      current_name: name || null,
      current_category: category || null,
      current_color: color || null,
      current_description: description || null,
      target_field: field,
    }

    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; url: string }> = [
      {
        type: 'text',
        text: `Latest human-edited catalogue context:\n${JSON.stringify(editorialContext)}\nImprove only target_field.`,
      },
    ]
    if (imageUrl) content.push({ type: 'image_url', url: imageUrl })

    const generated = await generateReply({
      config,
      systemPrompt: buildFieldRefinementPrompt(field, knownCategories, knownColors),
      messages: [{ role: 'user', content }],
      observabilityLabel: `Catálogo · melhorar ${field}`,
    })

    const maxLength = field === 'description' ? 4000 : field === 'name' ? 200 : 200
    const value = parseFieldRefinement(generated.text, maxLength)
    if (!value) {
      return NextResponse.json({ error: 'A IA não devolveu uma sugestão utilizável.' }, { status: 422 })
    }

    return NextResponse.json({ field, value })
  } catch (error) {
    return toErrorResponse(error)
  }
}

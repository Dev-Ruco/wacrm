import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type {
  RankedAgentCatalogProduct,
} from '@/lib/catalog/agent-search'
import type { CatalogProduct, CatalogProductVariant } from '@/lib/catalog/types'
import {
  parseVisualReferenceAssessments,
  visualReferenceConfidence,
  type VisualReferenceConfidence,
} from '@/lib/catalog/visual-reference'
import { createWhatsAppImageResolver } from './image-context'
import { generateReply } from './generate'
import type { AiConfig, ChatContentPart, ChatImagePart } from './types'

const MAX_RECENT_CUSTOMER_MESSAGES = 4
const MAX_CANDIDATE_PRODUCTS = 6
const MAX_IMAGES_PER_PRODUCT = 3
const MAX_COMPARISON_IMAGES = 18

interface RecentCustomerMessage {
  content_type: string
  media_url: string | null
}

interface VisualCandidateImage {
  candidateId: string
  product: CatalogProduct
  productKey: string
  imageIndex: number
  url: string
  source: 'product' | 'variant'
  variantId: string | null
  color: string | null
  size: string | null
}

export interface VisualProductMatch {
  score: number
  reason: string
  confidence: VisualReferenceConfidence
  matchedMedia: {
    imageIndex: number
    source: 'product' | 'variant'
    variantId: string | null
    color: string | null
    size: string | null
  }
  matchedColorStockQuantity: number | null
  matchedColorAvailableSizes: string[]
}

export interface VisualRankedCatalogProduct extends RankedAgentCatalogProduct {
  visual: VisualProductMatch
}

export interface VisualReferenceSearchResult {
  referenceFound: boolean
  comparisonSucceeded: boolean
  confidence: VisualReferenceConfidence | null
  matches: VisualRankedCatalogProduct[]
}

function normalizedColor(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-PT')
}

function productImages(product: CatalogProduct): Omit<VisualCandidateImage, 'candidateId' | 'product' | 'productKey'>[] {
  const raw = [
    {
      url: product.imageUrl ?? '',
      source: 'product' as const,
      variantId: null,
      color: null,
      size: null,
    },
    ...(product.variants ?? []).map((variant) => ({
      url: variant.imageUrl ?? '',
      source: 'variant' as const,
      variantId: variant.id,
      color: variant.color,
      size: variant.size,
    })),
  ]

  const seen = new Set<string>()
  const result: Omit<VisualCandidateImage, 'candidateId' | 'product' | 'productKey'>[] = []
  for (const image of raw) {
    if (!image.url) continue
    try {
      const parsed = new URL(image.url)
      if (parsed.protocol !== 'https:') continue
      const url = parsed.toString()
      if (seen.has(url)) continue
      seen.add(url)
      result.push({
        ...image,
        url,
        // Keep exactly the same 1-based index semantics used by send_product:
        // duplicate variant URLs do not consume an index.
        imageIndex: result.length + 1,
      })
    } catch {
      // Invalid catalogue media cannot participate in visual comparison.
    }
  }
  return result
}

function selectCandidateImages(
  candidates: readonly RankedAgentCatalogProduct[],
): VisualCandidateImage[] {
  const productBuckets = candidates.slice(0, MAX_CANDIDATE_PRODUCTS).map((candidate) => ({
    candidate,
    images: productImages(candidate.product).slice(0, MAX_IMAGES_PER_PRODUCT),
  }))

  const selected: VisualCandidateImage[] = []
  let sequence = 0
  for (let imagePosition = 0; imagePosition < MAX_IMAGES_PER_PRODUCT; imagePosition += 1) {
    for (const bucket of productBuckets) {
      const image = bucket.images[imagePosition]
      if (!image) continue
      sequence += 1
      selected.push({
        ...image,
        candidateId: `C${sequence}`,
        product: bucket.candidate.product,
        productKey: bucket.candidate.productKey,
      })
      if (selected.length >= MAX_COMPARISON_IMAGES) return selected
    }
  }
  return selected
}

async function latestCustomerReferenceImage(
  db: WacrmSupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ChatImagePart | null> {
  if (!conversationId) return null

  const { data, error } = await db
    .from('messages')
    .select('content_type, media_url')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(MAX_RECENT_CUSTOMER_MESSAGES)

  if (error) throw new Error('Recent customer media could not be loaded.')
  const recent = (data ?? []) as RecentCustomerMessage[]
  const imageMessage = recent.find(
    (message) => message.content_type === 'image' && Boolean(message.media_url),
  )
  if (!imageMessage?.media_url) return null

  return createWhatsAppImageResolver(db, accountId)(imageMessage.media_url)
}

function colorVariants(product: CatalogProduct, color: string | null): CatalogProductVariant[] {
  const wanted = normalizedColor(color)
  if (!wanted) return []
  return (product.variants ?? []).filter(
    (variant) => normalizedColor(variant.color) === wanted,
  )
}

function colorStock(product: CatalogProduct, color: string | null): number | null {
  const variants = colorVariants(product, color)
  if (variants.length === 0) return null
  const known = variants
    .map((variant) => variant.stockQuantity)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return known.length > 0
    ? known.reduce((total, value) => total + Math.max(0, value), 0)
    : null
}

function availableColorSizes(product: CatalogProduct, color: string | null): string[] {
  return Array.from(new Set(
    colorVariants(product, color)
      .filter((variant) => variant.stockQuantity === null || variant.stockQuantity > 0)
      .map((variant) => variant.size?.trim() ?? '')
      .filter(Boolean),
  ))
}

/**
 * Compare the latest customer reference photograph against real catalogue
 * photographs. Text retrieval first bounds the candidate set; this pass only
 * re-ranks those server-fetched candidates and never invents a product.
 */
export async function rankCatalogByVisualReference(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey'>
  query: string
  candidates: readonly RankedAgentCatalogProduct[]
  limit: number
}): Promise<VisualReferenceSearchResult> {
  const reference = await latestCustomerReferenceImage(
    args.db,
    args.accountId,
    args.conversationId,
  )
  if (!reference) {
    return {
      referenceFound: false,
      comparisonSucceeded: false,
      confidence: null,
      matches: [],
    }
  }

  const candidateImages = selectCandidateImages(args.candidates)
  if (candidateImages.length === 0) {
    return {
      referenceFound: true,
      comparisonSucceeded: false,
      confidence: null,
      matches: [],
    }
  }

  const content: ChatContentPart[] = [
    {
      type: 'text',
      text: [
        'REFERENCE: the next image is the customer reference photograph.',
        `Target object described by the conversation model: ${args.query}`,
        'Compare the commercial object/product only. Ignore every person in the photograph.',
      ].join('\n'),
    },
    reference,
  ]

  for (const candidate of candidateImages) {
    content.push({
      type: 'text',
      text: `${candidate.candidateId}: catalogue candidate photograph.`,
    })
    content.push({ type: 'image_url', url: candidate.url })
  }

  content.push({
    type: 'text',
    text: [
      'Return JSON only in this exact shape:',
      '{"matches":[{"candidate":"C1","score":0,"reason":"short visual reason"}]}',
      'Score every candidate image from 0 to 100 for visual similarity to the target commercial object in REFERENCE.',
      'Use visible shape/cut/design, pattern, colour and distinctive details. Do not infer price, stock, brand, identity or who the person is.',
    ].join('\n'),
  })

  const comparison = await generateReply({
    config: args.config,
    systemPrompt: [
      'You are a generic visual catalogue matcher for commerce.',
      'Compare products and commercial objects only; never identify, recognize or infer the identity of any person visible in a reference photograph.',
      'A candidate can only be judged from the photographs supplied. Do not create products, facts, prices, stock or brands.',
      'Return only the requested JSON object, with no Markdown or prose outside it.',
    ].join(' '),
    messages: [{ role: 'user', content }],
  })

  const assessments = parseVisualReferenceAssessments(
    comparison.text,
    candidateImages.map((candidate) => candidate.candidateId),
  )
  if (assessments.length === 0) {
    return {
      referenceFound: true,
      comparisonSucceeded: false,
      confidence: null,
      matches: [],
    }
  }

  const imageById = new Map(
    candidateImages.map((candidate) => [candidate.candidateId, candidate] as const),
  )
  const bestByProduct = new Map<string, { image: VisualCandidateImage; score: number; reason: string }>()
  for (const assessment of assessments) {
    const image = imageById.get(assessment.candidate)
    if (!image) continue
    const previous = bestByProduct.get(image.productKey)
    if (!previous || assessment.score > previous.score) {
      bestByProduct.set(image.productKey, {
        image,
        score: assessment.score,
        reason: assessment.reason,
      })
    }
  }

  const candidateByProduct = new Map(
    args.candidates.map((candidate) => [candidate.productKey, candidate] as const),
  )
  const ranked = Array.from(bestByProduct.entries())
    .map(([productKey, best]) => {
      const original = candidateByProduct.get(productKey)
      if (!original) return null
      return { original, best }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.best.score - a.best.score || b.original.score - a.original.score)

  const overallConfidence = ranked.length > 0
    ? visualReferenceConfidence(ranked[0].best.score, ranked[1]?.best.score ?? null)
    : null

  const matches = ranked.slice(0, Math.max(1, Math.min(5, args.limit))).map((entry, index) => ({
    ...entry.original,
    visual: {
      score: entry.best.score,
      reason: entry.best.reason,
      confidence: index === 0 && overallConfidence
        ? overallConfidence
        : visualReferenceConfidence(entry.best.score, null),
      matchedMedia: {
        imageIndex: entry.best.image.imageIndex,
        source: entry.best.image.source,
        variantId: entry.best.image.variantId,
        color: entry.best.image.color,
        size: entry.best.image.size,
      },
      matchedColorStockQuantity: colorStock(
        entry.original.product,
        entry.best.image.color,
      ),
      matchedColorAvailableSizes: availableColorSizes(
        entry.original.product,
        entry.best.image.color,
      ),
    },
  }))

  return {
    referenceFound: true,
    comparisonSucceeded: true,
    confidence: overallConfidence,
    matches,
  }
}

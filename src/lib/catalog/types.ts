export interface CatalogProductVariant {
  id: string
  sku?: string | null
  size: string | null
  color: string | null
  price?: number | null
  stockQuantity: number | null
  imageUrl?: string | null
}

export type CatalogProductSourceType = 'internal' | 'external_rest' | 'external_supabase'
export type CatalogSourceSyncMode = 'live' | 'mirror'
export type CatalogSourceSyncStatus = 'running' | 'succeeded' | 'failed'

export interface CatalogProduct {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  imageUrl: string | null
  productUrl: string | null
  category: string | null
  stockQuantity: number | null
  variants?: CatalogProductVariant[]
  sourceName: string
  /** Stable source capability marker. Do not infer internal/external from a UI label. */
  sourceType?: CatalogProductSourceType
  /** Generic tenant-defined offering type. External rows remain unknown until canonicalised. */
  offeringTypeId?: string | null
}

export interface CatalogSearchInput {
  query: string
  limit: number
  /** Account-specific category/colour vocabulary (see ./taxonomy.ts).
   *  Omit for plain textual matching with no synonym expansion. */
  categoryGroups?: readonly (readonly string[])[]
  colorGroups?: readonly (readonly string[])[]
}

export interface ExternalFieldMapping {
  items?: string
  id?: string
  name?: string
  description?: string
  price?: string
  currency?: string
  imageUrl?: string
  productUrl?: string
  category?: string
  stockQuantity?: string
  schema?: string
  table?: string
  searchColumns?: string[]
  activeColumn?: string
  publishedColumn?: string

  variantsTable?: string
  variantId?: string
  variantProductId?: string
  variantSize?: string
  variantColor?: string
  variantStock?: string
  variantImageUrl?: string
  variantActiveColumn?: string

  catalogTable?: string
  catalogId?: string
  catalogName?: string
  catalogDescription?: string
  catalogPrice?: string
  catalogCurrency?: string
  catalogImageUrl?: string
  catalogProductUrl?: string
  catalogCategory?: string
  catalogSearchColumns?: string[]
  catalogActiveColumn?: string
  catalogPublishedColumn?: string

  catalogVariantsTable?: string
  catalogVariantId?: string
  catalogVariantProductId?: string
  catalogVariantSize?: string
  catalogVariantColor?: string
  catalogVariantImageUrl?: string
  catalogVariantActiveColumn?: string

  brandsTable?: string
  brandId?: string
  brandName?: string
}

export interface CatalogSourceRow {
  id: string
  account_id: string
  name: string
  source_type: CatalogProductSourceType
  is_active: boolean
  base_url: string | null
  search_path: string | null
  sync_path?: string | null
  sync_mode?: CatalogSourceSyncMode
  last_synced_at?: string | null
  last_sync_status?: CatalogSourceSyncStatus | null
  last_sync_error?: string | null
  auth_type: 'none' | 'bearer' | 'api_key_header'
  auth_header: string | null
  auth_secret_encrypted: string | null
  field_mapping: ExternalFieldMapping | null
  meta_feed_token?: string | null
}

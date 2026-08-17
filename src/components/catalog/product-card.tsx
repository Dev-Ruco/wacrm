'use client'

import { useMemo, useState } from 'react'
import { ExternalLink, ImageIcon, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AttributeSelect, type AttributeOption } from './attribute-select'

export interface ProductVariant {
  id: string
  color: string | null
  image_url: string | null
  is_active: boolean
  size?: string | null
  sku?: string | null
  price?: number | string | null
  stock_quantity?: number | null
}

export interface Product {
  id: string
  name: string
  description: string | null
  color: string | null
  price: number | string
  currency: string
  image_url: string | null
  product_url: string | null
  category: string | null
  stock_quantity: number | null
  is_active: boolean
  catalog_id?: string | null
  variants?: ProductVariant[]
}

export interface ProductEditPatch {
  name?: string
  category?: string | null
  color?: string | null
  description?: string | null
  price?: number
  currency?: string
  stock_quantity?: number | null
  image_url?: string | null
  product_url?: string | null
}

export type CatalogViewMode = 'list' | 'grid' | 'compact'
type CatalogEditorialField = 'name' | 'category' | 'color' | 'description'

interface ColourOption {
  key: string
  label: string
  imageUrl: string | null
}

function colourKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt')
}

export function ProductCard({
  product,
  viewMode = 'grid',
  categoryOptions,
  colorOptions,
  onCreateCategory,
  onCreateColor,
  onToggle,
  onRemove,
  onSave,
}: {
  product: Product
  viewMode?: CatalogViewMode
  categoryOptions: AttributeOption[]
  colorOptions: AttributeOption[]
  onCreateCategory: (label: string) => Promise<string | null>
  onCreateColor: (label: string) => Promise<string | null>
  onToggle: () => void
  onRemove: () => void
  onSave: (patch: ProductEditPatch) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [color, setColor] = useState(product.color)
  const [description, setDescription] = useState(product.description ?? '')
  const [price, setPrice] = useState(String(product.price ?? ''))
  const [currency, setCurrency] = useState(product.currency || 'MZN')
  const [stockQuantity, setStockQuantity] = useState(
    product.stock_quantity == null ? '' : String(product.stock_quantity),
  )
  const [imageUrl, setImageUrl] = useState(product.image_url ?? '')
  const [productUrl, setProductUrl] = useState(product.product_url ?? '')
  const [saving, setSaving] = useState(false)
  const [refiningField, setRefiningField] = useState<CatalogEditorialField | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [selectedColourKey, setSelectedColourKey] = useState<string | null>(null)

  const colourVariants = useMemo<ColourOption[]>(() => {
    const colours = new Map<string, ColourOption>()

    for (const variant of product.variants ?? []) {
      if (variant.is_active === false) continue
      const label = variant.color?.trim()
      if (!label) continue
      const key = colourKey(label)
      const existing = colours.get(key)

      if (!existing) {
        colours.set(key, {
          key,
          label,
          imageUrl: variant.image_url || null,
        })
      } else if (!existing.imageUrl && variant.image_url) {
        colours.set(key, { ...existing, imageUrl: variant.image_url })
      }
    }

    return Array.from(colours.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt'))
  }, [product.variants])

  const selectedColour = selectedColourKey
    ? colourVariants.find((option) => option.key === selectedColourKey) ?? null
    : null
  const displayedImage = selectedColour?.imageUrl || product.image_url

  const complete = Boolean(product.name && product.category && product.description)

  function startEdit() {
    setName(product.name)
    setCategory(product.category)
    setColor(product.color)
    setDescription(product.description ?? '')
    setPrice(String(product.price ?? ''))
    setCurrency(product.currency || 'MZN')
    setStockQuantity(product.stock_quantity == null ? '' : String(product.stock_quantity))
    setImageUrl(product.image_url ?? '')
    setProductUrl(product.product_url ?? '')
    setRefineError(null)
    setRefiningField(null)
    setEditing(true)
  }

  async function refineWithAi(field: CatalogEditorialField) {
    setRefiningField(field)
    setRefineError(null)
    try {
      const response = await fetch('/api/catalog/refine-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          name: name.trim(),
          category: category?.trim() || null,
          color: color?.trim() || null,
          description: description.trim(),
          image_url: imageUrl.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível melhorar este campo com IA.')
      const value = typeof body.value === 'string' ? body.value.trim() : ''
      if (!value) throw new Error('A IA não devolveu uma sugestão utilizável.')

      if (field === 'name') setName(value)
      if (field === 'category') setCategory(value)
      if (field === 'color') setColor(value)
      if (field === 'description') setDescription(value)
    } catch (error) {
      setRefineError(error instanceof Error ? error.message : 'Erro ao melhorar o campo com IA.')
    } finally {
      setRefiningField(null)
    }
  }

  function AiFieldButton({ field }: { field: CatalogEditorialField }) {
    const loading = refiningField === field
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-[11px] text-primary"
        onClick={() => void refineWithAi(field)}
        disabled={refiningField !== null || saving}
        title="Melhorar somente este campo com IA"
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
        Melhorar com IA
      </Button>
    )
  }

  async function save() {
    const cleanedName = name.trim()
    const numericPrice = Number(price)
    if (!cleanedName || !Number.isFinite(numericPrice) || numericPrice < 0) return

    const stock = stockQuantity.trim() === '' ? null : Number(stockQuantity)
    if (stock != null && (!Number.isFinite(stock) || stock < 0)) return

    setSaving(true)
    try {
      await onSave({
        name: cleanedName,
        category,
        color,
        description: description.trim() || null,
        price: numericPrice,
        currency: currency.trim().toUpperCase() || 'MZN',
        stock_quantity: stock == null ? null : Math.floor(stock),
        image_url: imageUrl.trim() || null,
        product_url: productUrl.trim() || null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const priceLabel = `${Number(product.price).toLocaleString('pt-PT')} ${product.currency}`

  return (
    <article
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm',
        !product.is_active && 'opacity-65',
      )}
    >
      <div
        className={cn(
          viewMode === 'list' && 'grid gap-4 p-3 sm:grid-cols-[132px_minmax(0,1fr)_170px_auto] sm:items-center',
          viewMode === 'grid' && 'flex h-full flex-col',
          viewMode === 'compact' && 'flex h-full flex-col',
        )}
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden bg-muted/60',
            viewMode === 'list' && 'h-28 w-full rounded-lg sm:h-[112px] sm:w-[132px]',
            viewMode === 'grid' && 'aspect-[4/3] w-full border-b border-border/70',
            viewMode === 'compact' && 'aspect-square w-full border-b border-border/70',
          )}
        >
          {displayedImage ? (
            <img
              src={displayedImage}
              alt={selectedColour ? `${product.name} — ${selectedColour.label}` : product.name}
              className="h-full w-full object-contain p-2"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className={cn('text-muted-foreground', viewMode === 'grid' ? 'size-10' : 'size-7')} />
            </div>
          )}
          {viewMode !== 'list' ? (
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              <Badge variant={complete ? 'default' : 'outline'} className="h-5 bg-background/90 text-[10px] backdrop-blur-sm">
                {complete ? 'Pronto' : 'Falta informação'}
              </Badge>
              {!product.is_active ? (
                <Badge variant="outline" className="h-5 bg-background/90 text-[10px] backdrop-blur-sm">Inactivo</Badge>
              ) : null}
            </div>
          ) : null}
          {selectedColour && viewMode !== 'list' ? (
            <div className="absolute bottom-3 left-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur-sm">
              {selectedColour.label}
            </div>
          ) : null}
        </div>

        <div className={cn('min-w-0', viewMode !== 'list' && 'flex flex-1 flex-col p-4')}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('min-w-0 font-semibold text-foreground', viewMode === 'grid' ? 'text-base' : 'text-sm')}>
              {product.name}
            </h3>
            {viewMode === 'list' ? (
              <>
                <Badge variant={complete ? 'default' : 'outline'} className="h-5 text-[10px]">
                  {complete ? 'Pronto' : 'Falta informação'}
                </Badge>
                {!product.is_active ? <Badge variant="outline">Inactivo</Badge> : null}
              </>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {product.category || 'Sem categoria'}{product.color ? ` · ${product.color}` : ''}
          </p>

          <p
            className={cn(
              'mt-2 text-xs leading-5 text-muted-foreground',
              viewMode === 'list' ? 'line-clamp-2' : viewMode === 'compact' ? 'line-clamp-2' : 'line-clamp-3',
            )}
          >
            {product.description || 'Sem descrição comercial.'}
          </p>

          {colourVariants.length > 0 ? (
            <div className={cn('mt-3 min-w-0', viewMode === 'list' && 'max-w-xl')}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Cores disponíveis · {colourVariants.length}
                </p>
                {selectedColourKey ? (
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setSelectedColourKey(null)}
                  >
                    Foto principal
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {colourVariants.map((option) => {
                  const selected = selectedColourKey === option.key
                  const thumbnail = option.imageUrl || product.image_url
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setSelectedColourKey(selected ? null : option.key)}
                      className={cn(
                        'group w-[68px] shrink-0 rounded-lg border bg-background p-1.5 text-left transition',
                        selected
                          ? 'border-primary ring-2 ring-primary/15'
                          : 'border-border hover:border-foreground/25',
                      )}
                      title={`Ver ${option.label}`}
                    >
                      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-muted/50">
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={`${product.name} — ${option.label}`}
                            className="h-full w-full object-contain p-0.5"
                            loading="lazy"
                          />
                        ) : (
                          <ImageIcon className="size-5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="mt-1.5 block truncate text-[10px] font-medium text-foreground">
                        {option.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {viewMode !== 'list' ? (
            <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
              <div>
                <p className="font-semibold tabular-nums text-foreground">{priceLabel}</p>
                <p className="text-[11px] text-muted-foreground">Preço</p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums text-foreground">{product.stock_quantity ?? '—'}</p>
                <p className="text-[11px] text-muted-foreground">Stock</p>
              </div>
            </div>
          ) : null}

          {viewMode !== 'list' ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="min-w-[92px]" onClick={startEdit}>
                <Pencil />
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={onToggle}>
                {product.is_active ? 'Desactivar' : 'Activar'}
              </Button>
              <div className="ml-auto flex items-center gap-1">
                {product.product_url ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Abrir página do item"
                    render={<a href={product.product_url} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink />
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={onRemove}
                  aria-label="Remover item"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {viewMode === 'list' ? (
          <div className="grid grid-cols-2 gap-4 text-sm sm:block sm:text-right">
            <div>
              <p className="font-semibold tabular-nums">{priceLabel}</p>
              <p className="text-[11px] text-muted-foreground">Preço</p>
            </div>
            <div className="sm:mt-2">
              <p className="font-medium tabular-nums">{product.stock_quantity ?? '—'}</p>
              <p className="text-[11px] text-muted-foreground">Stock</p>
            </div>
          </div>
        ) : null}

        {viewMode === 'list' ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <Button size="sm" variant="outline" className="min-w-[92px]" onClick={startEdit}>
              <Pencil />
              Editar
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {product.is_active ? 'Desactivar' : 'Activar'}
            </Button>
            {product.product_url ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Abrir página do item"
                render={<a href={product.product_url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink />
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
              aria-label="Remover item"
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5 lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Nome comercial</Label>
                <AiFieldButton field="name" />
              </div>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Categoria</Label>
                <AiFieldButton field="category" />
              </div>
              <AttributeSelect kind="category" options={categoryOptions} value={category} onChange={setCategory} onCreate={onCreateCategory} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Cor</Label>
                <AiFieldButton field="color" />
              </div>
              <AttributeSelect kind="color" options={colorOptions} value={color} onChange={setColor} onCreate={onCreateColor} />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground lg:col-span-2">
              <span className="font-medium text-foreground">IA por campo:</span> melhora apenas o campo escolhido usando os valores actualmente escritos neste formulário. Preço, moeda e stock nunca são enviados à IA.
            </div>

            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Preço</Label>
                <Input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Moeda</Label>
                <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={8} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stock</Label>
              <Input type="number" min="0" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} placeholder="Não informado" />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Descrição comercial</Label>
                <AiFieldButton field="description" />
              </div>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={4000} />
              <p className="text-[11px] text-muted-foreground">
                Se alterar o nome acima e depois melhorar a descrição, a IA usa imediatamente esse novo nome como referência, mesmo antes de guardar.
              </p>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">URL da fotografia</Label>
              <Input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Página do item</Label>
              <Input type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="https://…" />
            </div>
          </div>

          {refineError ? (
            <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {refineError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving || refiningField !== null || !name.trim() || price.trim() === ''}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Guardar alterações
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving || refiningField !== null}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

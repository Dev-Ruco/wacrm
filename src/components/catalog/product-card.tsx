'use client'

import { useState } from 'react'
import { ExternalLink, ImageIcon, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AttributeSelect, type AttributeOption } from './attribute-select'

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
    setEditing(true)
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
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
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
              <Label className="text-xs">Nome comercial</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <AttributeSelect kind="category" options={categoryOptions} value={category} onChange={setCategory} onCreate={onCreateCategory} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cor</Label>
              <AttributeSelect kind="color" options={colorOptions} value={color} onChange={setColor} onCreate={onCreateColor} />
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
              <Label className="text-xs">Descrição comercial</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={4000} />
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

          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving || !name.trim() || price.trim() === ''}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Guardar alterações
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

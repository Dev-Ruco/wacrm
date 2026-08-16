'use client'

import { useState } from 'react'
import { ExternalLink, ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

/**
 * View mode is the default: photo, name, price, category · colour,
 * state. Editing expands the commercial fields so AI suggestions always
 * remain under human control.
 */
export function ProductCard({
  product,
  categoryOptions,
  colorOptions,
  onCreateCategory,
  onCreateColor,
  onToggle,
  onRemove,
  onSave,
}: {
  product: Product
  categoryOptions: AttributeOption[]
  colorOptions: AttributeOption[]
  onCreateCategory: (label: string) => Promise<string | null>
  onCreateColor: (label: string) => Promise<string | null>
  onToggle: () => void
  onRemove: () => void
  onSave: (patch: {
    name?: string
    category?: string | null
    color?: string | null
    description?: string | null
  }) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [color, setColor] = useState(product.color)
  const [description, setDescription] = useState(product.description ?? '')
  const [saving, setSaving] = useState(false)

  const complete = Boolean(product.name && product.category && product.description)

  function startEdit() {
    setName(product.name)
    setCategory(product.category)
    setColor(product.color)
    setDescription(product.description ?? '')
    setEditing(true)
  }

  async function save() {
    const cleanedName = name.trim()
    if (!cleanedName) return
    setSaving(true)
    try {
      await onSave({
        name: cleanedName,
        category,
        color,
        description: description.trim() || null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={!product.is_active ? 'opacity-60' : ''}>
      <div className="relative aspect-[4/3]">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <Badge variant={complete ? 'default' : 'outline'} className="absolute top-2 left-2">
          {complete ? 'Pronto' : 'Falta informação'}
        </Badge>
      </div>
      <CardContent className="space-y-3 pt-3">
        <div>
          <p className="font-medium">{product.name}</p>
          <p className="text-lg font-semibold">
            {Number(product.price).toLocaleString('pt-PT')} {product.currency}
          </p>
          {!editing ? (
            <p className="text-sm text-muted-foreground">
              {product.category || 'Sem categoria'}
              {product.color ? ` · ${product.color}` : ''}
            </p>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome comercial</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <AttributeSelect kind="category" options={categoryOptions} value={category} onChange={setCategory} onCreate={onCreateCategory} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cor</Label>
                <AttributeSelect kind="color" options={colorOptions} value={color} onChange={setColor} onCreate={onCreateColor} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição comercial</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={saving || !name.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <p className="line-clamp-4 text-sm text-muted-foreground">
            {product.description || 'Sem descrição — usa "Organizar com IA" ou edita à mão.'}
          </p>
        )}

        {!editing ? (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" variant="outline" onClick={onToggle}>
              {product.is_active ? 'Desactivar' : 'Activar'}
            </Button>
            <Button size="sm" variant="outline" onClick={startEdit}>
              Editar
            </Button>
            <Button size="sm" variant="destructive" onClick={onRemove}>
              <Trash2 />
              Remover
            </Button>
            {product.product_url ? (
              <Button size="sm" variant="ghost" render={<a href={product.product_url} target="_blank" rel="noreferrer" />}>
                <ExternalLink />
                Abrir
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

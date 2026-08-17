'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Grid2X2,
  Grid3X3,
  List,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AttributeOption } from './attribute-select'
import { BulkItemCard, isBulkItemComplete, type BulkItem } from './bulk-item-card'
import { BulkUploadDropzone } from './bulk-upload-dropzone'
import {
  ProductCard,
  type CatalogViewMode,
  type Product,
  type ProductEditPatch,
} from './product-card'
import {
  ReclassifyDialog,
  type ReclassifyMode,
  type ReclassifyProgress,
  type ReclassifyResult,
} from './reclassify-dialog'

const VIEW_MODE_STORAGE_KEY = 'wacrm.catalog.view-mode'

const initialProduct = {
  name: '',
  price: '',
  currency: 'MZN',
  image_url: '',
  description: '',
  category: '',
  product_url: '',
  stock_quantity: '',
}

interface TaxonomyTerm {
  kind: 'category' | 'color'
  canonical_value: string
}

interface AiEnrichmentResponse {
  name?: string | null
  price?: number | null
  currency?: string | null
  category?: string | null
  color?: string | null
  description?: string | null
  error?: string
}

type CreationMode = 'none' | 'single' | 'bulk'
type StatusFilter = 'all' | 'active' | 'inactive' | 'incomplete'

export function ProductsTab({
  products,
  setProducts,
  catalogId,
}: {
  products: Product[]
  setProducts: (updater: (current: Product[]) => Product[]) => void
  catalogId?: string
}) {
  const [productForm, setProductForm] = useState(initialProduct)
  const [savingProduct, setSavingProduct] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([])
  const [bulkSaving, setBulkSaving] = useState(false)
  const [terms, setTerms] = useState<TaxonomyTerm[]>([])
  const [creationMode, setCreationMode] = useState<CreationMode>('none')

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<CatalogViewMode>('grid')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<ReclassifyMode>('fill_empty')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ReclassifyProgress | null>(null)
  const [result, setResult] = useState<ReclassifyResult | null>(null)

  const loadTerms = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog/taxonomy', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (response.ok) setTerms(body.terms ?? [])
    } catch {
      // Non-fatal: the pickers fall back to free creation.
    }
  }, [])

  useEffect(() => {
    void loadTerms()
  }, [loadTerms])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
      if (stored === 'list' || stored === 'grid' || stored === 'compact') setViewMode(stored)
    } catch {
      // Local UI preference only; ignore unavailable storage.
    }
  }, [])

  function changeViewMode(next: CatalogViewMode) {
    setViewMode(next)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
    } catch {
      // Non-fatal.
    }
  }

  const categoryOptions: AttributeOption[] = terms
    .filter((term) => term.kind === 'category')
    .map((term) => ({ value: term.canonical_value, label: term.canonical_value }))

  const colorOptions: AttributeOption[] = terms
    .filter((term) => term.kind === 'color')
    .map((term) => ({ value: term.canonical_value, label: term.canonical_value }))

  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set(products.map((product) => product.category?.trim()).filter((value): value is string => Boolean(value))),
      ).sort((a, b) => a.localeCompare(b, 'pt')),
    [products],
  )

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt')
    return products.filter((product) => {
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false
      if (statusFilter === 'active' && !product.is_active) return false
      if (statusFilter === 'inactive' && product.is_active) return false
      if (
        statusFilter === 'incomplete' &&
        Boolean(product.name && product.category && product.description)
      ) {
        return false
      }
      if (!normalizedQuery) return true
      const haystack = [
        product.name,
        product.category,
        product.color,
        product.description,
        String(product.price ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt')
      return haystack.includes(normalizedQuery)
    })
  }, [products, query, categoryFilter, statusFilter])

  async function createTerm(kind: 'category' | 'color', label: string): Promise<string | null> {
    try {
      const response = await fetch('/api/catalog/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, canonical_value: label }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar.')
      setTerms((current) => [...current, { kind, canonical_value: body.term.canonical_value }])
      return body.term.canonical_value as string
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar.')
      return null
    }
  }

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/catalog/upload', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Falha no carregamento.')
      setProductForm((current) => ({ ...current, image_url: body.url }))
      toast.success('Fotografia carregada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro no carregamento.')
    } finally {
      setUploading(false)
    }
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingProduct(true)
    try {
      const response = await fetch('/api/catalog/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...productForm, catalog_id: catalogId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar o produto.')
      setProducts((current) => [body.product, ...current])
      setProductForm(initialProduct)
      setCreationMode('none')
      toast.success('Produto adicionado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar produto.')
    } finally {
      setSavingProduct(false)
    }
  }

  async function removeProduct(id: string) {
    if (!confirm('Remover este produto?')) return
    const response = await fetch(`/api/catalog/products/${id}`, { method: 'DELETE' })
    if (response.ok) {
      setProducts((current) => current.filter((product) => product.id !== id))
      toast.success('Produto removido.')
    } else {
      toast.error('Não foi possível remover o produto.')
    }
  }

  async function toggleProduct(product: Product) {
    const response = await fetch(`/api/catalog/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !product.is_active }),
    })
    const body = await response.json().catch(() => ({}))
    if (response.ok) {
      setProducts((current) => current.map((item) => (item.id === product.id ? body.product : item)))
    } else {
      toast.error(body.error ?? 'Não foi possível actualizar o produto.')
    }
  }

  async function saveProductEdits(product: Product, patch: ProductEditPatch) {
    const response = await fetch(`/api/catalog/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await response.json().catch(() => ({}))
    if (response.ok) {
      setProducts((current) => current.map((item) => (item.id === product.id ? body.product : item)))
      toast.success('Produto actualizado.')
    } else {
      toast.error(body.error ?? 'Não foi possível actualizar o produto.')
    }
  }

  function addBulkFiles(files: File[]) {
    const items: BulkItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      imageUrl: null,
      uploading: true,
      classifying: false,
      name: '',
      price: '',
      category: null,
      color: null,
      description: '',
    }))
    setBulkItems((current) => [...current, ...items])
    for (const item of items) void processBulkItem(item)
  }

  async function processBulkItem(item: BulkItem) {
    try {
      const form = new FormData()
      form.append('file', item.file)
      const uploadResponse = await fetch('/api/catalog/upload', { method: 'POST', body: form })
      const uploadBody = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok) throw new Error(uploadBody.error ?? 'Falha no carregamento.')

      setBulkItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? { ...currentItem, imageUrl: uploadBody.url, uploading: false, classifying: true }
            : currentItem,
        ),
      )

      const classifyResponse = await fetch('/api/catalog/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: uploadBody.url }),
      })
      const classifyBody = (await classifyResponse.json().catch(() => ({}))) as AiEnrichmentResponse

      setBulkItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                classifying: false,
                name: classifyResponse.ok && classifyBody.name ? classifyBody.name : currentItem.name,
                price:
                  classifyResponse.ok &&
                  typeof classifyBody.price === 'number' &&
                  Number.isFinite(classifyBody.price)
                    ? String(classifyBody.price)
                    : currentItem.price,
                category: classifyResponse.ok ? classifyBody.category ?? null : null,
                color: classifyResponse.ok ? classifyBody.color ?? null : null,
                description: classifyResponse.ok ? classifyBody.description ?? '' : '',
                error: classifyResponse.ok
                  ? undefined
                  : classifyBody.error ?? 'A IA não conseguiu organizar esta fotografia.',
              }
            : currentItem,
        ),
      )
    } catch (error) {
      setBulkItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                uploading: false,
                classifying: false,
                error: error instanceof Error ? error.message : 'Erro.',
              }
            : currentItem,
        ),
      )
    }
  }

  function updateBulkItem(id: string, patch: Partial<BulkItem>) {
    setBulkItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeBulkItem(id: string) {
    setBulkItems((current) => {
      const item = current.find((candidate) => candidate.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return current.filter((candidate) => candidate.id !== id)
    })
  }

  async function saveAllBulk() {
    const ready = bulkItems.filter(isBulkItemComplete)
    if (ready.length === 0) {
      toast.error('Confirma nome e preço de pelo menos um produto.')
      return
    }

    setBulkSaving(true)
    let saved = 0
    for (const item of ready) {
      try {
        const response = await fetch('/api/catalog/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalog_id: catalogId,
            name: item.name,
            price: item.price,
            image_url: item.imageUrl,
            description: item.description,
            category: item.category,
            color: item.color,
          }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? 'Erro ao gravar.')
        setProducts((current) => [body.product, ...current])
        saved += 1
        removeBulkItem(item.id)
      } catch (error) {
        toast.error(`${item.name || 'Produto'}: ${error instanceof Error ? error.message : 'erro'}`)
      }
    }
    setBulkSaving(false)
    if (saved > 0) toast.success(`${saved} produto(s) adicionado(s).`)
  }

  function openReclassify() {
    setResult(null)
    setProgress(null)
    setDialogOpen(true)
  }

  async function runReclassify() {
    const targets = products.filter((product) => product.image_url)
    if (targets.length === 0) return

    setRunning(true)
    setProgress({ current: 0, total: targets.length, label: targets[0].name })
    let classified = 0
    let needsReview = 0
    let failed = 0
    const failedNames: string[] = []

    for (const [index, product] of targets.entries()) {
      setProgress({ current: index + 1, total: targets.length, label: product.name })
      try {
        const classifyResponse = await fetch('/api/catalog/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: product.image_url }),
        })
        const classifyBody = (await classifyResponse.json().catch(() => ({}))) as AiEnrichmentResponse
        if (!classifyResponse.ok) throw new Error(classifyBody.error ?? 'Erro ao classificar.')

        const patch: ProductEditPatch =
          mode === 'review_all'
            ? {
                name: classifyBody.name || undefined,
                category: classifyBody.category ?? null,
                color: classifyBody.color ?? null,
                description: classifyBody.description || null,
              }
            : {
                category: product.category ? undefined : classifyBody.category ?? null,
                color: product.color ? undefined : classifyBody.color ?? null,
                description: product.description ? undefined : classifyBody.description || undefined,
              }

        const hasChange = Object.values(patch).some((value) => value !== undefined)
        if (hasChange) {
          const response = await fetch(`/api/catalog/products/${product.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar a organização.')
          setProducts((current) => current.map((item) => (item.id === product.id ? body.product : item)))
        }

        if (!classifyBody.category || !classifyBody.description || (mode === 'review_all' && !classifyBody.name)) {
          needsReview += 1
        } else {
          classified += 1
        }
      } catch (error) {
        failed += 1
        failedNames.push(product.name)
        console.error('[catalog] classify existing product failed:', product.id, error)
      }
    }

    setRunning(false)
    setProgress(null)
    setResult({ classified, needsReview, failed, failedNames })
  }

  const targetCount = products.filter((product) => product.image_url).length

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Itens do catálogo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filteredProducts.length === products.length
                ? `${products.length} item(ns)`
                : `${filteredProducts.length} de ${products.length} item(ns)`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={openReclassify}
              disabled={targetCount === 0}
            >
              <Sparkles />
              Organizar com IA
            </Button>
            <Button
              variant={creationMode === 'bulk' ? 'secondary' : 'outline'}
              onClick={() => setCreationMode((current) => (current === 'bulk' ? 'none' : 'bulk'))}
            >
              <Upload />
              Importar fotos
            </Button>
            <Button
              onClick={() => setCreationMode((current) => (current === 'single' ? 'none' : 'single'))}
            >
              <Plus />
              Adicionar item
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar por nome, categoria, cor ou descrição…"
              className="pl-9"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-9 min-w-[170px] rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            aria-label="Filtrar por categoria"
          >
            <option value="all">Todas as categorias</option>
            {availableCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-9 min-w-[150px] rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            aria-label="Filtrar por estado"
          >
            <option value="all">Todos os estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="incomplete">Falta informação</option>
          </select>

          <div className="flex h-9 shrink-0 items-center rounded-md border border-border bg-muted/30 p-0.5" aria-label="Modo de visualização">
            <Button
              type="button"
              size="icon-sm"
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              onClick={() => changeViewMode('list')}
              aria-label="Ver como lista"
              title="Lista"
            >
              <List />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              onClick={() => changeViewMode('grid')}
              aria-label="Ver em grade de duas colunas"
              title="Grade visual"
            >
              <Grid2X2 />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
              onClick={() => changeViewMode('compact')}
              aria-label="Ver em grade compacta"
              title="Grade compacta"
            >
              <Grid3X3 />
            </Button>
          </div>
        </div>

        {products.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Este catálogo ainda não tem itens.
            </CardContent>
          </Card>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">Nenhum item corresponde aos filtros.</p>
            <button
              type="button"
              className="mt-2 text-sm text-primary hover:underline"
              onClick={() => {
                setQuery('')
                setCategoryFilter('all')
                setStatusFilter('all')
              }}
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === 'list' && 'flex flex-col gap-3',
              viewMode === 'grid' && 'grid gap-4 lg:grid-cols-2',
              viewMode === 'compact' && 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
            )}
          >
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                viewMode={viewMode}
                categoryOptions={categoryOptions}
                colorOptions={colorOptions}
                onCreateCategory={(label) => createTerm('category', label)}
                onCreateColor={(label) => createTerm('color', label)}
                onToggle={() => void toggleProduct(product)}
                onRemove={() => void removeProduct(product.id)}
                onSave={(patch) => saveProductEdits(product, patch)}
              />
            ))}
          </div>
        )}
      </section>

      {creationMode === 'single' ? (
        <Card>
          <CardHeader>
            <CardTitle>Adicionar item</CardTitle>
            <CardDescription>
              Nome e preço são obrigatórios; os restantes campos ajudam o agente a vender melhor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitProduct} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input required value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} />
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <div className="space-y-2">
                  <Label>Preço</Label>
                  <Input type="number" min="0" step="0.01" required value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Moeda</Label>
                  <Input value={productForm.currency} onChange={(event) => setProductForm({ ...productForm, currency: event.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Fotografia</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file) }} />
                  <Input type="url" placeholder="ou cole uma URL pública" value={productForm.image_url} onChange={(event) => setProductForm({ ...productForm, image_url: event.target.value })} />
                </div>
                {uploading ? (
                  <p className="text-xs text-muted-foreground">
                    <Upload className="mr-1 inline size-3" />A carregar…
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Stock</Label>
                <Input type="number" min="0" value={productForm.stock_quantity} onChange={(event) => setProductForm({ ...productForm, stock_quantity: event.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Página do item</Label>
                <Input type="url" value={productForm.product_url} onChange={(event) => setProductForm({ ...productForm, product_url: event.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Descrição comercial</Label>
                <Textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={savingProduct || uploading}>
                  {savingProduct ? <Loader2 className="animate-spin" /> : <Plus />}
                  Adicionar item
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreationMode('none')}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {creationMode === 'bulk' ? (
        <Card>
          <CardHeader>
            <CardTitle>Importar vários itens de uma vez</CardTitle>
            <CardDescription>
              Arrasta várias fotografias. A IA prepara nome comercial, categoria e descrição para cada item e só preenche o preço quando o valor estiver claramente visível na própria imagem. Revê os dados antes de guardar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BulkUploadDropzone onFiles={addBulkFiles} disabled={bulkSaving} />
            {bulkItems.length > 0 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {bulkItems.map((item) => (
                    <BulkItemCard
                      key={item.id}
                      item={item}
                      categoryOptions={categoryOptions}
                      colorOptions={colorOptions}
                      onCreateCategory={(label) => createTerm('category', label)}
                      onCreateColor={(label) => createTerm('color', label)}
                      onChange={(patch) => updateBulkItem(item.id, patch)}
                      onRemove={() => removeBulkItem(item.id)}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void saveAllBulk()} disabled={bulkSaving}>
                    {bulkSaving ? <Loader2 className="animate-spin" /> : <Plus />}
                    Guardar todos
                  </Button>
                  <Button variant="ghost" onClick={() => setCreationMode('none')} disabled={bulkSaving}>
                    Fechar
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ReclassifyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        totalCount={targetCount}
        mode={mode}
        onModeChange={setMode}
        onConfirm={() => void runReclassify()}
        running={running}
        progress={progress}
        result={result}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}

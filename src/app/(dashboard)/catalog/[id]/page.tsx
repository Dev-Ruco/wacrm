'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CatalogWorkspaceNav } from '@/components/catalog/catalog-workspace-nav'
import { ProductsTab } from '@/components/catalog/products-tab'
import type { Product } from '@/components/catalog/product-card'

interface CatalogCollectionDetail {
  id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
  product_count: number
}

export default function CatalogDetailPage() {
  const params = useParams<{ id: string }>()
  const catalogId = params.id
  const [collection, setCollection] = useState<CatalogCollectionDetail | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!catalogId) return
    setLoading(true)
    try {
      const [collectionResponse, productsResponse] = await Promise.all([
        fetch(`/api/catalog/collections/${catalogId}`, { cache: 'no-store' }),
        fetch(`/api/catalog/products?catalog_id=${encodeURIComponent(catalogId)}`, { cache: 'no-store' }),
      ])
      const collectionBody = await collectionResponse.json().catch(() => ({}))
      const productsBody = await productsResponse.json().catch(() => ({}))
      if (!collectionResponse.ok) throw new Error(collectionBody.error ?? 'Catálogo não encontrado.')
      if (!productsResponse.ok) throw new Error(productsBody.error ?? 'Não foi possível carregar os itens.')
      setCollection(collectionBody.collection)
      setProducts(productsBody.products ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [catalogId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
      <CatalogWorkspaceNav active="offers" />

      <main className="min-w-0 flex-1 lg:pl-6">
        <header className="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="-ml-2 mb-3" render={<Link href="/catalog" />}>
              <ArrowLeft />
              Todos os catálogos
            </Button>
            <div className="flex flex-wrap items-center gap-2.5">
              <FolderOpen className="size-5 shrink-0 text-primary" />
              <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-2xl">
                {collection?.name ?? 'Catálogo'}
              </h1>
              {collection?.is_default ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Principal
                </span>
              ) : null}
              {collection ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {products.length} itens
                </span>
              ) : null}
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {collection?.description || 'Revê e corrige o conhecimento comercial que o agente usa neste catálogo.'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualizar
          </Button>
        </header>

        <div className="pt-5">
          {loading && !collection ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              A carregar catálogo…
            </div>
          ) : collection ? (
            <div className="[&>div]:flex [&>div]:flex-col [&>div>*:nth-child(1)]:order-3 [&>div>*:nth-child(2)]:order-4 [&>div>*:nth-child(3)]:order-1 [&>div>*:nth-child(4)]:order-2 [&>div>*:nth-child(5)]:order-5">
              <ProductsTab products={products} setProducts={setProducts} catalogId={catalogId} />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Não foi possível abrir este catálogo.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

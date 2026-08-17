'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface CatalogCollectionSummary {
  id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
  product_count: number
  active_product_count: number
  created_at: string
  updated_at: string
}

export function CatalogCollectionsPanel() {
  const [collections, setCollections] = useState<CatalogCollectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const loadCollections = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/catalog/collections', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar os catálogos.')
      setCollections(body.collections ?? [])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao carregar os catálogos.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCollections()
  }, [loadCollections])

  const totals = useMemo(
    () => ({
      catalogues: collections.length,
      items: collections.reduce((sum, collection) => sum + collection.product_count, 0),
      activeItems: collections.reduce((sum, collection) => sum + collection.active_product_count, 0),
    }),
    [collections],
  )

  function startEditing(collection: CatalogCollectionSummary) {
    setExpandedId(collection.id)
    setEditingId(collection.id)
    setEditName(collection.name)
    setEditDescription(collection.description ?? '')
  }

  async function saveCollection(collection: CatalogCollectionSummary) {
    const name = editName.trim()
    if (!name) {
      toast.error('O nome do catálogo é obrigatório.')
      return
    }

    setSavingId(collection.id)
    try {
      const response = await fetch(`/api/catalog/collections/${collection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: editDescription.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível actualizar o catálogo.')
      setCollections((current) =>
        current.map((item) =>
          item.id === collection.id ? { ...item, ...body.collection } : item,
        ),
      )
      setEditingId(null)
      toast.success('Catálogo actualizado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao actualizar o catálogo.')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteCollection(collection: CatalogCollectionSummary) {
    const itemNote =
      collection.product_count > 0
        ? ` Os ${collection.product_count} item(ns) serão movidos para outro catálogo, nunca apagados.`
        : ''
    if (!confirm(`Apagar o catálogo “${collection.name}”?${itemNote}`)) return

    setDeletingId(collection.id)
    try {
      const response = await fetch(`/api/catalog/collections/${collection.id}`, {
        method: 'DELETE',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível apagar o catálogo.')
      setCollections((current) => current.filter((item) => item.id !== collection.id))
      if (expandedId === collection.id) setExpandedId(null)
      if (editingId === collection.id) setEditingId(null)
      if (body.moved_items > 0 && body.fallback?.name) {
        toast.success(`Catálogo apagado. ${body.moved_items} item(ns) movidos para “${body.fallback.name}”.`)
      } else {
        toast.success('Catálogo apagado.')
      }
      void loadCollections()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao apagar o catálogo.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Os seus catálogos</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Organize diferentes linhas de produtos ou negócios em catálogos separados. Os itens só aparecem depois de abrir o catálogo correspondente.
          </p>
        </div>
        <Button render={<Link href="/catalog/new" />}>
          <Plus />
          Adicionar catálogo
        </Button>
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-r border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">Catálogos</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{loadError ? '—' : totals.catalogues}</p>
        </div>
        <div className="border-r border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">Itens</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{loadError ? '—' : totals.items}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Activos</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{loadError ? '—' : totals.activeItems}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            A carregar catálogos…
          </div>
        ) : loadError ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="size-5 text-destructive" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">Não foi possível carregar os catálogos</h3>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{loadError}</p>
            <Button className="mt-4" variant="outline" onClick={() => void loadCollections()}>
              Tentar novamente
            </Button>
          </div>
        ) : collections.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="size-5 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">Ainda não há catálogos</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Crie o primeiro catálogo e depois adicione as fotografias ou itens que o agente deve conhecer.
            </p>
            <Button className="mt-4" render={<Link href="/catalog/new" />}>
              <Plus />
              Criar primeiro catálogo
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {collections.map((collection) => {
              const expanded = expandedId === collection.id
              const editing = editingId === collection.id
              return (
                <div key={collection.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : collection.id)}
                    className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45"
                    aria-expanded={expanded}
                  >
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-180',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {collection.name}
                        </span>
                        {collection.is_default ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Principal
                          </span>
                        ) : null}
                        {!collection.is_active ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            Inactivo
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {collection.description || 'Sem descrição'}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-sm font-medium tabular-nums">{collection.product_count}</p>
                      <p className="text-[11px] text-muted-foreground">itens</p>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-border/70 bg-muted/20 px-4 py-4 sm:pl-11">
                      {editing ? (
                        <div className="max-w-2xl space-y-3">
                          <div className="space-y-1.5">
                            <Label>Nome do catálogo</Label>
                            <Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={160} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Descrição</Label>
                            <Textarea
                              rows={3}
                              value={editDescription}
                              onChange={(event) => setEditDescription(event.target.value)}
                              placeholder="Ex.: Colecção feminina, viaturas para aluguer, electrodomésticos…"
                              maxLength={1200}
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void saveCollection(collection)} disabled={savingId === collection.id}>
                              {savingId === collection.id ? <Loader2 className="animate-spin" /> : null}
                              Guardar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={savingId === collection.id}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm text-foreground">
                              {collection.product_count} item(ns) · {collection.active_product_count} activo(s)
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Abra o catálogo para ver, importar, classificar e editar os respectivos itens.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => startEditing(collection)}>
                              <Pencil />
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void deleteCollection(collection)}
                              disabled={deletingId === collection.id}
                            >
                              {deletingId === collection.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                              Apagar
                            </Button>
                            <Button size="sm" render={<Link href={`/catalog/${collection.id}`} />}>
                              Abrir catálogo
                              <ArrowRight />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

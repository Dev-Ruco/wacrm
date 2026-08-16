'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FolderPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CatalogWorkspaceNav } from '@/components/catalog/catalog-workspace-nav'

export default function NewCatalogPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return

    setSaving(true)
    try {
      const response = await fetch('/api/catalog/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          description: description.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar o catálogo.')
      toast.success('Catálogo criado.')
      router.push(`/catalog/${body.collection.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar o catálogo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
      <CatalogWorkspaceNav active="overview" />

      <main className="min-w-0 flex-1 lg:pl-6">
        <header className="border-b border-border/80 pb-5">
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" render={<Link href="/catalog" />}>
            <ArrowLeft />
            Voltar aos catálogos
          </Button>
          <div className="flex items-center gap-2.5">
            <FolderPlus className="size-5 text-primary" />
            <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">Adicionar catálogo</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Crie uma área separada para uma linha de produtos, serviço, marca, frota ou outro conjunto comercial.
          </p>
        </header>

        <div className="pt-5">
          <form onSubmit={submit} className="max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Informação do catálogo</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                O nome deve permitir que a equipa perceba imediatamente o que está dentro deste catálogo.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="catalog-name">Nome</Label>
                <Input
                  id="catalog-name"
                  autoFocus
                  required
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Moda feminina, Viaturas para aluguer, Electrodomésticos"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-description">Descrição</Label>
                <Textarea
                  id="catalog-description"
                  rows={4}
                  maxLength={1200}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Explique brevemente o tipo de ofertas que pertencem a este catálogo."
                />
                <p className="text-xs text-muted-foreground">
                  Esta descrição organiza a gestão interna; cada item continua a ter a sua própria descrição comercial.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-5 py-4">
              <Button variant="ghost" type="button" render={<Link href="/catalog" />} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <FolderPlus />}
                Criar catálogo
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

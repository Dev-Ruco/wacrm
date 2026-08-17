'use client'

import { useRef, useState } from 'react'
import { FileJson2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface ImportResponse {
  error?: string
  package?: { products?: number; variants?: number }
  imported?: {
    products_created?: number
    products_updated?: number
    variants_created?: number
    variants_updated?: number
  }
  images?: { copied?: number; failed?: number; skipped?: number }
}

export function CatalogPackageImport({
  catalogId,
  catalogName,
  onImported,
}: {
  catalogId: string
  catalogName: string
  onImported: () => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast.error('Seleccione um ficheiro .json de catálogo.')
      return
    }

    let preview: { products?: unknown[] } | null = null
    try {
      preview = JSON.parse(await file.text()) as { products?: unknown[] }
    } catch {
      toast.error('O ficheiro não contém JSON válido.')
      return
    }
    const productCount = Array.isArray(preview?.products) ? preview.products.length : 0
    if (!confirm(`Importar ${productCount} produto(s) para “${catalogName}”? As imagens serão copiadas para o WACRM e variantes existentes com o mesmo ID/SKU serão actualizadas.`)) {
      return
    }

    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('catalog_id', catalogId)
      form.append('copy_images', 'true')
      const response = await fetch('/api/catalog/import-package', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({})) as ImportResponse
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível importar o catálogo.')

      const importedProducts = (body.imported?.products_created ?? 0) + (body.imported?.products_updated ?? 0)
      const importedVariants = (body.imported?.variants_created ?? 0) + (body.imported?.variants_updated ?? 0)
      const imageNote = body.images?.failed
        ? ` · ${body.images.copied ?? 0} imagens copiadas, ${body.images.failed} falharam`
        : ` · ${body.images?.copied ?? 0} imagens copiadas`
      toast.success(`${importedProducts} produto(s) e ${importedVariants} variante(s) importados${imageNote}.`)
      await onImported()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao importar o catálogo.')
    } finally {
      setImporting(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
      >
        {importing ? <Loader2 className="animate-spin" /> : <FileJson2 />}
        {importing ? 'A importar…' : 'Importar ficheiro'}
      </Button>
    </>
  )
}

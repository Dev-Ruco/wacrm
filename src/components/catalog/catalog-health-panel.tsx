'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, HeartPulse, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Severity = 'info' | 'warning' | 'critical'

interface HealthIssue {
  issueType: string
  severity: Severity
  title: string
  description: string
  productId: string | null
  sourceId: string | null
}

interface Health {
  score: number
  totalProducts: number
  activeProducts: number
  productsWithMedia: number
  productsWithOfferingType: number
  missingRequiredAttributeCount: number
  failedMirrorSourceCount: number
  issues: HealthIssue[]
}

function severityLabel(severity: Severity): string {
  if (severity === 'critical') return 'Crítico'
  if (severity === 'warning') return 'Atenção'
  return 'Informação'
}

export function CatalogHealthPanel() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/health', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível avaliar o catálogo.')
      setHealth(body.health)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao avaliar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function scan() {
    setScanning(true)
    try {
      const response = await fetch('/api/catalog/health', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível executar a auditoria.')
      setHealth(body.health)
      toast.success(`Auditoria concluída: ${body.queued ?? 0} ponto(s) para revisão.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro na auditoria.')
    } finally {
      setScanning(false)
    }
  }

  if (loading && !health) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> A avaliar catálogo…
      </div>
    )
  }

  if (!health) return null

  const critical = health.issues.filter((issue) => issue.severity === 'critical').length
  const warnings = health.issues.filter((issue) => issue.severity === 'warning').length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Saúde do catálogo</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Verifica automaticamente qualidade de apresentação, estrutura obrigatória, possíveis duplicados e estado dos espelhos canónicos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || scanning}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualizar
          </Button>
          <Button onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Loader2 className="animate-spin" /> : <HeartPulse />}
            Auditar e registar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card size="sm"><CardHeader><CardDescription>Índice de saúde</CardDescription><CardTitle>{health.score}/100</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Ofertas activas</CardDescription><CardTitle>{health.activeProducts}</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Com imagem</CardDescription><CardTitle>{health.productsWithMedia}</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Atributos obrigatórios em falta</CardDescription><CardTitle>{health.missingRequiredAttributeCount}</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Espelhos com problema</CardDescription><CardTitle>{health.failedMirrorSourceCount}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {critical === 0 && warnings === 0 ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            Pontos encontrados
          </CardTitle>
          <CardDescription>
            {critical} crítico(s), {warnings} aviso(s), {health.issues.length} no total.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {health.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum problema detectado pelas regras actuais.</p>
          ) : (
            health.issues.slice(0, 100).map((issue, index) => (
              <div key={`${issue.issueType}:${issue.productId ?? issue.sourceId ?? index}`} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{severityLabel(issue.severity)}</span>
                  <p className="font-medium">{issue.title}</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
              </div>
            ))
          )}
          {health.issues.length > 100 ? (
            <p className="text-xs text-muted-foreground">A mostrar os primeiros 100 de {health.issues.length} pontos.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

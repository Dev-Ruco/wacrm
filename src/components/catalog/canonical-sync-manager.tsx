'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DatabaseZap, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type SyncMode = 'live' | 'mirror'
type SyncStatus = 'running' | 'succeeded' | 'failed' | null

interface Source {
  id: string
  name: string
  source_type: string
  is_active: boolean
  sync_mode?: SyncMode
  last_synced_at?: string | null
  last_sync_status?: SyncStatus
  last_sync_error?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Nunca'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Desconhecida'
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function statusLabel(status: SyncStatus | undefined): string {
  if (status === 'running') return 'A sincronizar'
  if (status === 'succeeded') return 'Sincronizado'
  if (status === 'failed') return 'Falhou'
  return 'Sem sincronização'
}

export function CanonicalSyncManager() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [busySourceId, setBusySourceId] = useState<string | null>(null)

  const databaseSources = useMemo(
    () => sources.filter((source) => source.source_type === 'external_supabase'),
    [sources],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/sources', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar as fontes.')
      setSources(body.sources ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar fontes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function setMode(source: Source, mode: SyncMode) {
    setBusySourceId(source.id)
    try {
      const response = await fetch(`/api/catalog/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_mode: mode }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível alterar o modo da fonte.')
      setSources((current) => current.map((item) => item.id === source.id ? body.source : item))
      if (mode === 'mirror' && body.source?.last_sync_status !== 'succeeded') {
        toast.success('Modo espelho preparado. Faça a primeira sincronização para activar o catálogo canónico.')
      } else {
        toast.success(mode === 'mirror' ? 'Modo espelho activado.' : 'Consulta directa activada.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao alterar o modo.')
    } finally {
      setBusySourceId(null)
    }
  }

  async function sync(source: Source) {
    setBusySourceId(source.id)
    try {
      const response = await fetch(`/api/catalog/sources/${source.id}/sync`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível sincronizar a fonte.')
      const result = body.sync ?? {}
      toast.success(
        `Sincronização concluída: ${result.fetchedCount ?? 0} lidas, ${result.createdCount ?? 0} novas, ${result.updatedCount ?? 0} actualizadas.`,
      )
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro de sincronização.')
      await load()
    } finally {
      setBusySourceId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-5 w-5" />
          <CardTitle>Catálogo canónico</CardTitle>
        </div>
        <CardDescription>
          No modo espelho, o WA CRM copia e normaliza os produtos e variações da base externa. Depois de uma
          sincronização completa, o agente consulta a cópia canónica e deixa de depender da base externa durante a conversa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar fontes…
          </div>
        ) : databaseSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ligue primeiro uma base Supabase externa.</p>
        ) : (
          databaseSources.map((source) => {
            const mode = source.sync_mode ?? 'live'
            const busy = busySourceId === source.id
            return (
              <div key={source.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {mode === 'mirror' ? 'Espelho canónico' : 'Consulta directa'} · {statusLabel(source.last_sync_status)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Última sincronização: {formatDate(source.last_synced_at)}
                    </p>
                    {source.last_sync_error ? (
                      <p className="mt-1 max-w-xl text-xs text-destructive">{source.last_sync_error}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !source.is_active}
                      onClick={() => void setMode(source, mode === 'mirror' ? 'live' : 'mirror')}
                    >
                      {mode === 'mirror' ? 'Usar directo' : 'Usar espelho'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !source.is_active}
                      onClick={() => void sync(source)}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      Sincronizar agora
                    </Button>
                  </div>
                </div>
                {mode === 'mirror' && source.last_sync_status !== 'succeeded' ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Até existir uma sincronização bem-sucedida, o agente mantém consulta directa como fallback.
                  </p>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

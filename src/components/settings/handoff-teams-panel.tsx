'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { Loader2, Plus, Trash2, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/use-auth'
import type { AccountMember } from '@/types'

interface HandoffQueue {
  id: string
  routing_key: string
  name: string
  description: string | null
  enabled: boolean
  priority: number
  member_user_ids: string[]
}

const COPY = {
  pt: {
    title: 'Equipas especialistas',
    description: 'Organize quem recebe handoffs por assunto. O papel de acesso continua separado: uma especialidade não dá permissões administrativas.',
    newName: 'Nome da equipa',
    newDescription: 'O que esta equipa resolve (opcional)',
    create: 'Criar equipa',
    noTeams: 'Ainda não há equipas especialistas. Exemplos: Vendas, Suporte técnico, Pagamentos, Nutrição.',
    members: 'Especialistas',
    noEligible: 'Convide ou promova pelo menos um membro com acesso de agente para receber handoffs.',
    saved: 'Equipa actualizada',
    created: 'Equipa criada',
    deleted: 'Equipa eliminada',
    loadFailed: 'Não foi possível carregar as equipas',
    saveFailed: 'Não foi possível guardar a equipa',
    createFailed: 'Não foi possível criar a equipa',
    deleteFailed: 'Não foi possível eliminar a equipa',
    enabled: 'Activa',
    route: 'Chave interna',
    priority: 'Prioridade',
    priorityHint: 'Menor número = preferência maior quando várias equipas são aplicáveis.',
    routingHint: 'Quando o agente pede um handoff, o servidor escolhe primeiro alguém online, depois menor carga de conversas, e por fim a prioridade do membro.',
    deleteConfirm: 'Eliminar esta equipa? Os membros continuam na conta; apenas o encaminhamento por esta especialidade é removido.',
  },
  en: {
    title: 'Specialist teams',
    description: 'Organize who receives handoffs by subject. Access roles stay separate: a specialty never grants admin permissions.',
    newName: 'Team name',
    newDescription: 'What this team handles (optional)',
    create: 'Create team',
    noTeams: 'No specialist teams yet. Examples: Sales, Technical support, Billing, Nutrition.',
    members: 'Specialists',
    noEligible: 'Invite or promote at least one member with agent access to receive handoffs.',
    saved: 'Team updated',
    created: 'Team created',
    deleted: 'Team deleted',
    loadFailed: 'Could not load teams',
    saveFailed: 'Could not save team',
    createFailed: 'Could not create team',
    deleteFailed: 'Could not delete team',
    enabled: 'Enabled',
    route: 'Internal key',
    priority: 'Priority',
    priorityHint: 'Lower number = higher preference when multiple teams apply.',
    routingHint: 'When the agent requests a handoff, the server prefers an online specialist, then lower open-conversation load, then member priority.',
    deleteConfirm: 'Delete this team? Members stay in the account; only this specialist routing is removed.',
  },
} as const

export function HandoffTeamsPanel() {
  const locale = useLocale()
  const copy = locale.toLowerCase().startsWith('pt') ? COPY.pt : COPY.en
  const { canManageMembers } = useAuth()
  const [queues, setQueues] = useState<HandoffQueue[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [queueRes, memberRes] = await Promise.all([
        fetch('/api/account/handoff-queues', { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
      ])
      if (!queueRes.ok || !memberRes.ok) throw new Error('load failed')
      const queueData = await queueRes.json() as { queues?: HandoffQueue[] }
      const memberData = await memberRes.json() as { members?: AccountMember[] }
      setQueues(queueData.queues ?? [])
      setMembers(memberData.members ?? [])
    } catch (error) {
      console.error('[handoff teams] load failed:', error)
      toast.error(copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [copy.loadFailed])

  useEffect(() => {
    void load()
  }, [load])

  const eligibleMembers = members.filter((member) => member.role !== 'viewer')

  async function createQueue() {
    if (!name.trim() || busy) return
    setBusy('create')
    try {
      const res = await fetch('/api/account/handoff-queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || copy.createFailed)
        return
      }
      setName('')
      setDescription('')
      toast.success(copy.created)
      await load()
    } catch (error) {
      console.error('[handoff teams] create failed:', error)
      toast.error(copy.createFailed)
    } finally {
      setBusy(null)
    }
  }

  async function patchQueue(queue: HandoffQueue, patch: Record<string, unknown>) {
    setBusy(queue.id)
    try {
      const res = await fetch(`/api/account/handoff-queues/${queue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || copy.saveFailed)
        return false
      }
      toast.success(copy.saved)
      await load()
      return true
    } catch (error) {
      console.error('[handoff teams] update failed:', error)
      toast.error(copy.saveFailed)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function toggleMember(queue: HandoffQueue, userId: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...queue.member_user_ids, userId]))
      : queue.member_user_ids.filter((id) => id !== userId)
    await patchQueue(queue, { member_user_ids: next })
  }

  async function deleteQueue(queue: HandoffQueue) {
    if (!window.confirm(copy.deleteConfirm)) return
    setBusy(queue.id)
    try {
      const res = await fetch(`/api/account/handoff-queues/${queue.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || copy.deleteFailed)
        return
      }
      toast.success(copy.deleted)
      setQueues((current) => current.filter((item) => item.id !== queue.id))
    } catch (error) {
      console.error('[handoff teams] delete failed:', error)
      toast.error(copy.deleteFailed)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin" /></div>
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2 text-base">
            <UsersRound className="size-4 text-primary" /> {copy.title}
          </CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        {canManageMembers ? (
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={copy.newName} />
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={copy.newDescription} />
            <Button onClick={() => void createQueue()} disabled={!name.trim() || busy === 'create'}>
              {busy === 'create' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {copy.create}
            </Button>
          </CardContent>
        ) : null}
      </Card>

      {queues.length === 0 ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground">{copy.noTeams}</CardContent></Card>
      ) : null}

      {queues.map((queue) => {
        const isBusy = busy === queue.id
        return (
          <Card key={queue.id}>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle as="h3" className="text-base">{queue.name}</CardTitle>
                  {queue.description ? <CardDescription>{queue.description}</CardDescription> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{copy.route}: {queue.routing_key}</Badge>
                  {canManageMembers ? (
                    <>
                      <Switch
                        checked={queue.enabled}
                        onCheckedChange={(enabled) => void patchQueue(queue, { enabled })}
                        disabled={isBusy}
                        aria-label={copy.enabled}
                      />
                      <Button variant="ghost" size="icon" onClick={() => void deleteQueue(queue)} disabled={isBusy}>
                        {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">{copy.members}</p>
                {eligibleMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{copy.noEligible}</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {eligibleMembers.map((member) => {
                      const checked = queue.member_user_ids.includes(member.user_id)
                      return (
                        <label key={member.user_id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{member.full_name || member.email || member.user_id}</span>
                            <span className="text-xs text-muted-foreground">{member.role}</span>
                          </span>
                          <Switch
                            checked={checked}
                            onCheckedChange={(value) => void toggleMember(queue, member.user_id, value)}
                            disabled={!canManageMembers || isBusy}
                          />
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{copy.routingHint}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

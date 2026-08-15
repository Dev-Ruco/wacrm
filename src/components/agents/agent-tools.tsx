'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  Image,
  Loader2,
  Sparkles,
  Tags,
  UserRoundCheck,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { CollapsibleEditor } from '@/components/ui/collapsible-editor'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/hooks/use-can'

interface ToolConfig {
  enabled: boolean
  instructions: string | null
}

interface ToolDefinition {
  key: string
  label: string
  description: string | null
  actionClass: 'read' | 'communication' | 'mutation' | 'handoff'
  reversible: boolean
  externalImpact: boolean
  defaultEnabled: boolean
  sortOrder: number
}

interface ToolState {
  configured: boolean
  agent_id: string | null
  definitions: ToolDefinition[]
  tools: Record<string, ToolConfig>
  last_used_at?: Record<string, string>
  used_by_skills?: Record<string, string[]>
}

type ToolKey = string

const TOOL_ICONS: Record<string, typeof Boxes> = {
  search_catalog: Boxes,
  send_product: Image,
  search_knowledge: BookOpen,
  add_tag: Tags,
  create_deal: BriefcaseBusiness,
  schedule_visit: CalendarClock,
  get_style_opinion: Sparkles,
  handoff_human: UserRoundCheck,
}

function actionClassLabel(actionClass: ToolDefinition['actionClass']) {
  if (actionClass === 'mutation') return 'Executa uma acção'
  if (actionClass === 'communication') return 'Comunica com o cliente'
  if (actionClass === 'handoff') return 'Transfere o atendimento'
  return 'Consulta informação'
}

export function AgentTools() {
  const canEdit = useCan('edit-settings')
  const [state, setState] = useState<ToolState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<ToolKey | null>(null)
  const [editingKey, setEditingKey] = useState<ToolKey | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/tools', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as ferramentas.')
      setState(data as ToolState)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as ferramentas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (toolKey: ToolKey, enabled: boolean) => {
    if (!state || saving) return
    const previous = state.tools[toolKey]
    if (!previous) return
    setSaving(toolKey)
    setState((current) => (current ? {
      ...current,
      tools: { ...current.tools, [toolKey]: { ...previous, enabled } },
    } : current))
    try {
      const response = await fetch('/api/ai/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_key: toolKey, enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a ferramenta.')
      toast.success(enabled ? 'Ferramenta activada.' : 'Ferramenta desactivada.')
    } catch (error) {
      setState((current) => (current ? {
        ...current,
        tools: { ...current.tools, [toolKey]: previous },
      } : current))
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a ferramenta.')
    } finally {
      setSaving(null)
    }
  }

  function startEdit(toolKey: ToolKey) {
    setDraft(state?.tools[toolKey]?.instructions ?? '')
    setEditingKey(toolKey)
  }

  function cancelEdit() {
    setEditingKey(null)
    setDraft('')
  }

  const saveInstructions = async (toolKey: ToolKey) => {
    if (!state || saving) return
    const previous = state.tools[toolKey]
    if (!previous) return
    setSaving(toolKey)
    const instructions = draft.trim() || null
    try {
      const response = await fetch('/api/ai/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_key: toolKey, enabled: previous.enabled, instructions }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível guardar as instruções.')
      setState((current) => (current ? {
        ...current,
        tools: { ...current.tools, [toolKey]: { ...previous, instructions } },
      } : current))
      toast.success('Instruções guardadas.')
      cancelEdit()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível guardar as instruções.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!state) return null

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Ferramentas</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Defina exactamente aquilo que este agente pode consultar ou executar durante uma conversa.
        </p>
      </div>

      {!state.configured && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Configure e guarde primeiro o agente de IA.
        </div>
      )}

      <div className="space-y-3">
        {state.definitions.map((definition) => {
          const toolKey = definition.key
          const Icon = TOOL_ICONS[toolKey] ?? Wrench
          const tool = state.tools[toolKey] ?? {
            enabled: definition.defaultEnabled,
            instructions: null,
          }
          // send_product depends on a catalogue result in the current runtime.
          // This is an execution dependency, not a platform-wide tool allow-list.
          const dependencyBlocked = toolKey === 'send_product' && !state.tools.search_catalog?.enabled
          const rowDisabled = !canEdit || !state.configured || dependencyBlocked
          const editing = editingKey === toolKey

          return (
            <CollapsibleEditor
              key={toolKey}
              editing={editing}
              canEdit={!rowDisabled}
              onToggle={() => (editing ? cancelEdit() : startEdit(toolKey))}
              onCancel={cancelEdit}
              onSave={() => saveInstructions(toolKey)}
              saving={saving === toolKey}
              saveLabel="Guardar instruções"
              headerActions={
                <Switch
                  checked={tool.enabled}
                  disabled={!canEdit || !state.configured || saving !== null || dependencyBlocked}
                  onCheckedChange={(enabled) => void toggle(toolKey, enabled)}
                  aria-label={definition.label}
                />
              }
              header={
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">{definition.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dependencyBlocked
                        ? 'Active primeiro "Consultar catálogo".'
                        : state.last_used_at?.[toolKey]
                          ? `Última utilização: ${new Date(state.last_used_at[toolKey]!).toLocaleString('pt-PT')}`
                          : 'Ainda sem utilização registada'}
                      {state.used_by_skills?.[toolKey]?.length
                        ? ` · Usada por: ${state.used_by_skills[toolKey]!.join(', ')}`
                        : ''}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="space-y-1">
                {definition.description && (
                  <p className="text-sm text-muted-foreground">{definition.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {actionClassLabel(definition.actionClass)}
                  {definition.externalImpact ? ' · Pode ter impacto externo' : ''}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Instruções extra para esta ferramenta (opcional)
                </label>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ex.: nesta conta, não agendamos visitas à loja aos domingos."
                  rows={2}
                  className="text-sm"
                />
              </div>
            </CollapsibleEditor>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Ban,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Layers3,
  List,
  MessageSquare,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck,
  Workflow,
  Wrench,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { autoLayout } from '@/lib/flows/layout'
import {
  buildLiveExecutionGraph,
  runDurationMs,
  stepKind,
  upsertLiveRun,
  upsertLiveStep,
  type AgentLiveRun,
  type AgentLiveStep,
  type LiveStepStatus,
} from '@/lib/ai/live-observability'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'

type AgentTab = 'runtime' | 'tools' | 'usage' | 'playground'
type ViewMode = 'graph' | 'timeline'

interface ExecutionNodeData extends Record<string, unknown> {
  step: AgentLiveStep
}

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const RUN_TIME_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  hour: '2-digit',
  minute: '2-digit',
})

const STATUS_LABEL: Record<string, string> = {
  running: 'Em processamento',
  completed: 'Concluído',
  failed: 'Falhou',
  blocked: 'Bloqueado',
  handoff: 'Handoff',
}

const STEP_STATUS_CLASS: Record<LiveStepStatus, string> = {
  running: 'border-primary/70 bg-primary/10',
  completed: 'border-emerald-500/40 bg-emerald-500/10',
  failed: 'border-destructive/60 bg-destructive/10',
  blocked: 'border-amber-500/60 bg-amber-500/10',
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

function stepIcon(step: AgentLiveStep) {
  switch (stepKind(step.type)) {
    case 'message':
      return MessageSquare
    case 'context':
      return Clock3
    case 'memory':
      return BrainCircuit
    case 'skill':
      return Layers3
    case 'model':
      return Cpu
    case 'tool':
      return Wrench
    case 'guardrail':
      return ShieldCheck
    case 'response':
      return Send
    case 'handoff':
      return UserRoundCheck
    default:
      return Workflow
  }
}

function StepStatusIcon({ status }: { status: LiveStepStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />
  if (status === 'blocked') return <Ban className="h-3.5 w-3.5 text-amber-600" />
  return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
}

function ExecutionNode({ data }: NodeProps) {
  const { step } = data as ExecutionNodeData
  const Icon = stepIcon(step)
  return (
    <div
      className={cn(
        'relative w-[220px] rounded-xl border bg-card px-4 py-3 shadow-sm transition-shadow',
        STEP_STATUS_CLASS[step.status],
        step.status === 'running' && 'shadow-md',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-background/80 p-2 text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{step.label}</p>
            <span className="ml-auto"><StepStatusIcon status={step.status} /></span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {step.type} · {formatDuration(step.duration_ms)}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

const NODE_TYPES = { execution: ExecutionNode }

export function buildExecutionFlow(steps: AgentLiveStep[], reducedMotion = false): {
  nodes: Node<ExecutionNodeData>[]
  edges: Edge[]
} {
  const graph = buildLiveExecutionGraph(steps)
  const positions = autoLayout(
    graph.nodes.map((node) => ({ id: node.id, width: 220, height: 86 })),
    graph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    { direction: 'LR', rankSep: 72, nodeSep: 24, defaultWidth: 220 },
  )
  return {
    nodes: graph.nodes.map(({ id, step }) => ({
      id,
      type: 'execution',
      data: { step },
      position: positions.get(id) ?? { x: 0, y: 0 },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: edge.active && !reducedMotion,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: edge.active ? 'var(--primary)' : 'var(--border)' },
    })),
  }
}

function RunStatusBadge({ run }: { run: AgentLiveRun }) {
  return (
    <Badge variant={run.status === 'running' ? 'default' : 'secondary'}>
      {run.status === 'running' && <Radio className="h-3 w-3 animate-pulse motion-reduce:animate-none" />}
      {STATUS_LABEL[run.status] ?? run.status}
    </Badge>
  )
}

function metadataText(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata ?? {})
  if (keys.length === 0) return 'Sem metadata adicional.'
  return JSON.stringify(metadata, null, 2)
}

export function AgentFlowPanel({ onOpenTab }: { onOpenTab: (tab: AgentTab) => void }) {
  const { accountId, profileLoading } = useAuth()
  const [runs, setRuns] = useState<AgentLiveRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentLiveStep[]>([])
  const [selectedStep, setSelectedStep] = useState<AgentLiveStep | null>(null)
  const [view, setView] = useState<ViewMode>('graph')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [tick, setTick] = useState(0)

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mobile = window.matchMedia('(max-width: 767px)')
    const syncMotion = () => setReducedMotion(media.matches)
    syncMotion()
    if (mobile.matches) setView('timeline')
    media.addEventListener?.('change', syncMotion)
    return () => media.removeEventListener?.('change', syncMotion)
  }, [])

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== 'running') return
    const timer = window.setInterval(() => setTick((value) => value + 1), 250)
    return () => window.clearInterval(timer)
  }, [selectedRun])

  const loadRuns = useCallback(async () => {
    if (profileLoading) return
    if (!accountId) {
      setError('Não foi possível identificar a conta actual.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: runsError } = await supabase
        .from('agent_traces')
        .select('id, conversation_id, intent, model_tier, final_action, status, provider, model, total_ms, started_at, finished_at, created_at')
        .eq('account_id', accountId)
        .order('started_at', { ascending: false })
        .limit(30)
      if (runsError) throw runsError
      const next = (data ?? []) as AgentLiveRun[]
      setRuns(next)
      setSelectedRunId((current) =>
        current && next.some((run) => run.id === current) ? current : (next[0]?.id ?? null),
      )
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar as execuções do agente.',
      )
    } finally {
      setLoading(false)
    }
  }, [accountId, profileLoading])

  const loadSteps = useCallback(async (runId: string) => {
    if (!accountId) return
    const supabase = createClient()
    const { data, error: stepsError } = await supabase
      .from('agent_trace_steps')
      .select('id, trace_id, sequence, type, label, status, started_at, finished_at, duration_ms, metadata')
      .eq('account_id', accountId)
      .eq('trace_id', runId)
      .order('sequence', { ascending: true })
    if (stepsError) {
      setError(stepsError.message)
      return
    }
    setSteps((data ?? []) as AgentLiveStep[])
  }, [accountId])

  useEffect(() => { void loadRuns() }, [loadRuns])
  useEffect(() => {
    setSelectedStep(null)
    if (selectedRunId) void loadSteps(selectedRunId)
    else setSteps([])
  }, [selectedRunId, loadSteps])

  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`agent-live-observability:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'wacrm', table: 'agent_traces', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as AgentLiveRun
          if (!row?.id) return
          setRuns((current) => upsertLiveRun(current, row))
          if (payload.eventType === 'INSERT') setSelectedRunId(row.id)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'wacrm', table: 'agent_trace_steps', filter: `account_id=eq.${accountId}` },
        (payload) => {
          const row = payload.new as AgentLiveStep
          if (!row?.id) return
          if (row.trace_id === selectedRunId) {
            setSteps((current) => upsertLiveStep(current, row))
            setSelectedStep((current) => current?.id === row.id ? row : current)
          }
        },
      )
      .subscribe((status) => setIsConnected(status === 'SUBSCRIBED'))

    return () => {
      void supabase.removeChannel(channel)
      setIsConnected(false)
    }
  }, [accountId, selectedRunId])

  const flow = useMemo(() => buildExecutionFlow(steps, reducedMotion), [steps, reducedMotion])
  const duration = selectedRun ? runDurationMs(selectedRun) : 0
  void tick

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> A carregar execuções…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">Fluxo ao vivo indisponível</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => void loadRuns()}>
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </Button>
      </div>
    )
  }

  if (runs.length === 0 || !selectedRun) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Workflow className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 font-semibold text-foreground">Ainda não há nenhuma execução para mostrar</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Envie uma mensagem de teste ou aguarde uma nova mensagem do WhatsApp. O fluxo mostrará apenas passos realmente registados pelo runtime.
        </p>
        <Button className="mt-5" onClick={() => onOpenTab('playground')}>Abrir Playground</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Execução real do agente</p>
            <RunStatusBadge run={selectedRun} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selectedRun.provider ?? 'provider'} · {selectedRun.model ?? 'modelo'} · {formatDuration(duration)} · conversa {selectedRun.conversation_id.slice(0, 8)}…
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? 'secondary' : 'outline'}>
            <span className={cn('h-1.5 w-1.5 rounded-full', isConnected ? 'bg-emerald-500' : 'bg-muted-foreground')} />
            {isConnected ? 'Ao vivo' : 'A ligar'}
          </Badge>
          <div className="flex rounded-lg border border-border p-0.5">
            <Button type="button" size="sm" variant={view === 'graph' ? 'secondary' : 'ghost'} onClick={() => setView('graph')}>
              <Workflow className="h-4 w-4" /> Grafo
            </Button>
            <Button type="button" size="sm" variant={view === 'timeline' ? 'secondary' : 'ghost'} onClick={() => setView('timeline')}>
              <List className="h-4 w-4" /> Timeline
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="max-h-[620px] overflow-y-auto rounded-xl border border-border bg-card p-2">
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Execuções recentes</p>
          <div className="space-y-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                  run.id === selectedRun.id ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{RUN_TIME_FORMATTER.format(new Date(run.started_at))}</span>
                  <span className={cn('ml-auto h-2 w-2 rounded-full', run.status === 'running' ? 'animate-pulse bg-primary motion-reduce:animate-none' : run.status === 'failed' ? 'bg-destructive' : run.status === 'blocked' ? 'bg-amber-500' : 'bg-emerald-500')} />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{run.intent ?? 'turno'} · {run.final_action}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-muted/20">
          {steps.length === 0 ? (
            <div className="flex h-[560px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Esta execução ainda não tem passos observáveis registados.
            </div>
          ) : view === 'graph' ? (
            <div className="h-[560px]">
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={NODE_TYPES}
                nodesDraggable={false}
                nodesConnectable={false}
                deleteKeyCode={null}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                minZoom={0.3}
                maxZoom={1.5}
                onNodeClick={(_, node) => setSelectedStep((node.data as ExecutionNodeData).step)}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto p-3 sm:p-4">
              <ol className="space-y-2">
                {steps.map((step) => (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedStep(step)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left hover:bg-muted/50"
                    >
                      <StepStatusIcon status={step.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{step.label}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{step.type}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs tabular-nums text-muted-foreground">{TIME_FORMATTER.format(new Date(step.started_at))}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatDuration(step.duration_ms)}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        O fluxo mostra apenas telemetria operacional persistida. Não expõe chain-of-thought, prompts privados, chaves ou payloads completos do cliente.
      </p>

      <Sheet open={Boolean(selectedStep)} onOpenChange={(open) => !open && setSelectedStep(null)}>
        <SheetContent className="overflow-y-auto">
          {selectedStep && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedStep.label}</SheetTitle>
                <SheetDescription>{selectedStep.type} · sequência {selectedStep.sequence + 1}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Estado</p>
                    <p className="mt-1 text-sm font-medium">{STATUS_LABEL[selectedStep.status] ?? selectedStep.status}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Duração</p>
                    <p className="mt-1 text-sm font-medium tabular-nums">{formatDuration(selectedStep.duration_ms)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata sanitizada</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{metadataText(selectedStep.metadata ?? {})}</pre>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Este inspector mostra apenas factos observáveis do runtime. O raciocínio privado do modelo não é guardado nem apresentado.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

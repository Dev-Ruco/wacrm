'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Ban,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  History,
  Layers3,
  List,
  Maximize2,
  MessageSquare,
  Minimize2,
  Radio,
  RefreshCw,
  Route,
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
  normalizeLiveRun,
  normalizeLiveStep,
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
type TopologyKind =
  | 'channel'
  | 'context'
  | 'state'
  | 'intent'
  | 'skills'
  | 'memory'
  | 'agent'
  | 'model'
  | 'tool'
  | 'guardrail'
  | 'response'
  | 'handoff'

interface ExecutionNodeData extends Record<string, unknown> { step: AgentLiveStep }
interface TopologyNodeData extends Record<string, unknown> {
  topologyId: string
  label: string
  subtitle: string
  kind: TopologyKind
  active: boolean
  completed: boolean
  failed: boolean
}
interface RuntimeTopologyConfig {
  agentName: string
  agentRole: string
  provider: string
  model: string
  skills: string[]
  tools: string[]
}
interface PacketEdgeData extends Record<string, unknown> {
  packetActive?: boolean
  reducedMotion?: boolean
}

const EMPTY_TOPOLOGY: RuntimeTopologyConfig = {
  agentName: 'Agente de IA',
  agentRole: 'Runtime conversacional',
  provider: 'provider',
  model: 'modelo',
  skills: [],
  tools: [],
}

const TOOL_LABELS: Record<string, string> = {
  search_catalog: 'Consultar catálogo',
  send_product: 'Enviar produto',
  search_knowledge: 'Consultar conhecimento',
  add_tag: 'Adicionar tag',
  create_deal: 'Criar negócio',
  schedule_visit: 'Agendar visita',
  get_style_opinion: 'Opinião de estilo',
  handoff_human: 'Handoff humano',
}

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const RUN_TIME_FORMATTER = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' })
const STATUS_LABEL: Record<string, string> = {
  running: 'Em processamento', completed: 'Concluído', failed: 'Falhou', blocked: 'Bloqueado', handoff: 'Handoff',
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
    case 'message': return MessageSquare
    case 'context': return Clock3
    case 'memory': return BrainCircuit
    case 'skill': return Layers3
    case 'model': return Cpu
    case 'tool': return Wrench
    case 'guardrail': return ShieldCheck
    case 'response': return Send
    case 'handoff': return UserRoundCheck
    default: return Workflow
  }
}

function topologyIcon(kind: TopologyKind) {
  switch (kind) {
    case 'channel': return MessageSquare
    case 'context': return Database
    case 'state': return BrainCircuit
    case 'intent': return Route
    case 'skills': return Layers3
    case 'memory': return BrainCircuit
    case 'agent': return Bot
    case 'model': return Cpu
    case 'tool': return Wrench
    case 'guardrail': return ShieldCheck
    case 'response': return Send
    case 'handoff': return UserRoundCheck
  }
}

function StepStatusIcon({ status }: { status: LiveStepStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />
  if (status === 'blocked') return <Ban className="h-3.5 w-3.5 text-amber-600" />
  return <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" />
}

function ExecutionNode({ data }: NodeProps) {
  const { step } = data as ExecutionNodeData
  const Icon = stepIcon(step)
  return (
    <div className={cn('relative w-[220px] rounded-xl border bg-card px-4 py-3 shadow-sm', STEP_STATUS_CLASS[step.status])}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-background/80 p-2"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{step.label}</p>
            <span className="ml-auto"><StepStatusIcon status={step.status} /></span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{step.type} · {formatDuration(step.duration_ms)}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

function TopologyNode({ data }: NodeProps) {
  const node = data as TopologyNodeData
  const Icon = topologyIcon(node.kind)
  return (
    <div className={cn(
      'relative w-[184px] rounded-xl border bg-card px-3 py-3 shadow-sm transition-all duration-300',
      node.kind === 'agent' && 'w-[218px] border-primary/40 bg-primary/5 shadow-md',
      node.active && 'border-primary bg-primary/10 shadow-lg ring-2 ring-primary/20',
      node.completed && !node.active && 'border-emerald-500/35',
      node.failed && 'border-destructive/70 bg-destructive/5',
    )}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="target" id="top" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-2.5">
        <div className={cn('rounded-lg bg-muted p-2 text-muted-foreground', node.active && 'bg-primary/15 text-primary')}>
          <Icon className={cn('h-4 w-4', node.active && 'animate-pulse motion-reduce:animate-none')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{node.label}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{node.subtitle}</p>
        </div>
        {node.active && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />}
        {node.completed && !node.active && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
        {node.failed && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <Handle type="source" id="bottom" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

function PacketEdge(props: EdgeProps) {
  if (![props.sourceX, props.sourceY, props.targetX, props.targetY].every(Number.isFinite)) return null
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 18,
  })
  const data = (props.data ?? {}) as PacketEdgeData
  const active = Boolean(data.packetActive)
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ ...props.style, stroke: active ? 'var(--primary)' : 'var(--border)', strokeWidth: active ? 2.4 : 1.4 }}
      />
      {active && !data.reducedMotion && (
        <circle r="5" fill="var(--primary)">
          <animateMotion dur="0.86s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  )
}

const NODE_TYPES = { execution: ExecutionNode, topology: TopologyNode }
const EDGE_TYPES = { packet: PacketEdge }

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
    nodes: graph.nodes.map(({ id, step }) => ({ id, type: 'execution', data: { step }, position: positions.get(id) ?? { x: 0, y: 0 } })),
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

function toolNodeId(key: string) { return `tool:${key}` }

function topologyIdForStep(step: AgentLiveStep, tools: string[]): string {
  const type = String(step.type ?? '').toLowerCase()
  const label = String(step.label ?? '').toLowerCase()
  if (type.includes('message')) return 'whatsapp_in'
  if (type.includes('working_state') || type === 'state_updated' || type.includes('state')) return 'working_state'
  if (type.includes('intent')) return 'intent'
  if (type.includes('skill')) return 'skills'
  if (type.includes('memory')) return 'memory'
  if (type.includes('context')) return 'context'
  if (type.includes('llm') || type.includes('model')) return 'model'
  if (type.includes('guardrail')) return 'guardrails'
  if (type.includes('response')) return 'whatsapp_out'
  if (type.includes('handoff')) return tools.includes('handoff_human') ? toolNodeId('handoff_human') : 'whatsapp_out'
  if (type.includes('tool')) {
    const tool = tools.find((key) => label === key || label.includes(key))
    if (tool) return toolNodeId(tool)
  }
  return 'agent'
}

function playbackPathForSteps(steps: AgentLiveStep[], tools: string[]): string[] {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
  const result: string[] = []
  for (const step of ordered) {
    const nodeId = topologyIdForStep(step, tools)
    if (result[result.length - 1] !== nodeId) result.push(nodeId)
  }
  return result
}

function playbackDelay(nodeId: string, backlog: number): number {
  const base = nodeId === 'model' || nodeId.startsWith('tool:') ? 1050
    : nodeId === 'guardrails' || nodeId === 'whatsapp_out' ? 800
      : 900
  if (backlog >= 6) return Math.max(650, Math.round(base * 0.72))
  if (backlog >= 3) return Math.max(760, Math.round(base * 0.86))
  return base
}

function buildPersistentTopology(
  config: RuntimeTopologyConfig,
  steps: AgentLiveStep[],
  run: AgentLiveRun | null,
  reducedMotion: boolean,
  playbackPath: string[],
  playbackCursor: number,
): { nodes: Node<TopologyNodeData>[]; edges: Edge[] } {
  const playbackFinished = Boolean(run && run.status !== 'running' && playbackPath.length > 0 && playbackCursor >= playbackPath.length - 1)
  const current = playbackFinished ? null : playbackPath[playbackCursor] ?? null
  const previous = playbackCursor > 0 ? playbackPath[playbackCursor - 1] ?? null : null
  const completed = new Set(playbackFinished ? playbackPath : playbackPath.slice(0, Math.max(0, playbackCursor)))
  const failedStep = [...steps].reverse().find((step) => step.status === 'failed' || step.status === 'blocked')
  const failed = failedStep ? topologyIdForStep(failedStep, config.tools) : null

  const nodes: Node<TopologyNodeData>[] = []
  const edges: Edge[] = []
  const addNode = (id: string, label: string, subtitle: string, kind: TopologyKind, x: number, y: number) => {
    nodes.push({
      id,
      type: 'topology',
      position: { x, y },
      data: { topologyId: id, label, subtitle, kind, active: current === id, completed: completed.has(id), failed: failed === id },
    })
  }
  const addEdge = (source: string, target: string, sourceHandle?: string, targetHandle?: string) => {
    const packetActive = Boolean(previous === source && current === target)
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'packet',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { packetActive, reducedMotion },
    })
  }

  addNode('whatsapp_in', 'WhatsApp', 'Mensagem recebida', 'channel', 0, 250)
  addNode('context', 'Contexto', 'Histórico e dados da conversa', 'context', 225, 250)
  addNode('working_state', 'Working State', 'Objectivo e restrições actuais', 'state', 450, 40)
  addNode('intent', 'Intenção', 'Leitura do movimento conversacional', 'intent', 450, 250)
  addNode('skills', 'Skills', config.skills.length > 0 ? `${config.skills.length} activas` : 'Nenhuma activa', 'skills', 450, 460)
  addNode('memory', 'Memória', 'Contexto útil do contacto', 'memory', 700, 40)
  addNode('agent', config.agentName || 'Agente de IA', config.agentRole || 'Cérebro do atendimento', 'agent', 700, 250)
  addNode('model', 'Modelo', `${config.provider} · ${config.model}`, 'model', 980, 250)
  addNode('guardrails', 'Guardrails', 'Validação antes da saída', 'guardrail', 1230, 250)
  addNode('whatsapp_out', 'WhatsApp', 'Resposta ao cliente', 'response', 1465, 250)

  addEdge('whatsapp_in', 'context')
  addEdge('context', 'intent')
  addEdge('intent', 'agent')
  addEdge('working_state', 'agent', undefined, 'top')
  addEdge('skills', 'agent')
  addEdge('memory', 'agent', undefined, 'top')
  addEdge('agent', 'model')
  addEdge('model', 'guardrails')
  addEdge('guardrails', 'whatsapp_out')

  const toolBaseY = 545
  const columns = 4
  config.tools.forEach((tool, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const x = 790 + col * 220
    const y = toolBaseY + row * 115
    const kind: TopologyKind = tool === 'handoff_human' ? 'handoff' : 'tool'
    addNode(toolNodeId(tool), TOOL_LABELS[tool] ?? tool, tool, kind, x, y)
    addEdge('model', toolNodeId(tool), 'bottom', 'top')
    if (tool !== 'handoff_human') addEdge(toolNodeId(tool), 'model')
  })

  if (previous && current) {
    const directId = `${previous}->${current}`
    const direct = edges.find((edge) => edge.id === directId)
    if (direct) {
      direct.data = { ...(direct.data ?? {}), packetActive: true, reducedMotion }
    } else if (nodes.some((node) => node.id === previous) && nodes.some((node) => node.id === current)) {
      edges.push({
        id: `playback:${directId}`,
        source: previous,
        target: current,
        type: 'packet',
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { packetActive: true, reducedMotion },
      })
    }
  }

  return { nodes, edges }
}

function RunStatusBadge({ run, playbackActive }: { run: AgentLiveRun; playbackActive: boolean }) {
  return (
    <Badge variant={run.status === 'running' ? 'default' : 'secondary'}>
      {(run.status === 'running' || playbackActive) && <Radio className="h-3 w-3 animate-pulse motion-reduce:animate-none" />}
      {playbackActive && run.status !== 'running' ? 'A reproduzir' : (STATUS_LABEL[run.status] ?? run.status)}
    </Badge>
  )
}

function metadataText(metadata: Record<string, unknown>): string {
  return Object.keys(metadata ?? {}).length === 0 ? 'Sem metadata adicional.' : JSON.stringify(metadata, null, 2)
}

export function AgentFlowPanel({ onOpenTab }: { onOpenTab: (tab: AgentTab) => void }) {
  const { accountId, profileLoading } = useAuth()
  const [runs, setRuns] = useState<AgentLiveRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentLiveStep[]>([])
  const [selectedStep, setSelectedStep] = useState<AgentLiveStep | null>(null)
  const [view, setView] = useState<ViewMode>('graph')
  const [loading, setLoading] = useState(true)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [topologyError, setTopologyError] = useState<string | null>(null)
  const [topologyConfig, setTopologyConfig] = useState<RuntimeTopologyConfig>(EMPTY_TOPOLOGY)
  const [isConnected, setIsConnected] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [playbackCursor, setPlaybackCursor] = useState(-1)
  const [tick, setTick] = useState(0)

  const selectedRunIdRef = useRef<string | null>(null)
  const stepLoadTokenRef = useRef(0)
  const flowRef = useRef<ReactFlowInstance<Node<TopologyNodeData>, Edge> | null>(null)

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const playbackPath = useMemo(() => playbackPathForSteps(steps, topologyConfig.tools), [steps, topologyConfig.tools])
  const playbackActive = playbackPath.length > 0 && (
    playbackCursor < playbackPath.length - 1 || selectedRun?.status === 'running'
  )

  const recenter = useCallback((duration = 250) => {
    window.setTimeout(() => {
      void flowRef.current?.fitView({ padding: 0.08, minZoom: 0.5, maxZoom: 1, duration })
    }, 40)
  }, [])

  const selectRun = useCallback((runId: string | null, clear = false) => {
    selectedRunIdRef.current = runId
    setSelectedRunId(runId)
    setSelectedStep(null)
    setPlaybackCursor(-1)
    if (clear) setSteps([])
    recenter(220)
  }, [recenter])

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

  useEffect(() => {
    if (!fullScreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullScreen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [fullScreen])

  useEffect(() => { recenter(200) }, [fullScreen, topologyConfig, recenter])

  useEffect(() => {
    if (playbackPath.length === 0) {
      if (playbackCursor !== -1) setPlaybackCursor(-1)
      return
    }
    if (playbackCursor < 0) {
      setPlaybackCursor(0)
      return
    }
    if (playbackCursor >= playbackPath.length - 1) return
    const backlog = playbackPath.length - playbackCursor - 1
    const delay = reducedMotion ? 80 : playbackDelay(playbackPath[playbackCursor], backlog)
    const timer = window.setTimeout(() => setPlaybackCursor((cursor) => Math.min(cursor + 1, playbackPath.length - 1)), delay)
    return () => window.clearTimeout(timer)
  }, [playbackCursor, playbackPath, reducedMotion])

  const loadTopology = useCallback(async () => {
    setTopologyError(null)
    try {
      const [configResult, toolsResult, skillsResult] = await Promise.allSettled([
        fetch('/api/ai/config', { cache: 'no-store' }).then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? 'Configuração indisponível')
          return data
        }),
        fetch('/api/ai/tools', { cache: 'no-store' }).then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? 'Ferramentas indisponíveis')
          return data
        }),
        fetch('/api/ai/skills', { cache: 'no-store' }).then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? 'Skills indisponíveis')
          return data
        }),
      ])
      const config = configResult.status === 'fulfilled' ? configResult.value : {}
      const toolsPayload = toolsResult.status === 'fulfilled' ? toolsResult.value : {}
      const skillsPayload = skillsResult.status === 'fulfilled' ? skillsResult.value : {}
      const enabledTools = Object.entries(toolsPayload.tools ?? {})
        .filter(([, value]) => Boolean((value as { enabled?: boolean })?.enabled))
        .map(([key]) => key)
      const enabledSkills = Array.isArray(skillsPayload.skills)
        ? skillsPayload.skills.filter((skill: { enabled?: boolean }) => skill.enabled).map((skill: { name?: string }) => skill.name).filter(Boolean)
        : []
      setTopologyConfig({
        agentName: config.agent_name ?? 'Agente de IA',
        agentRole: config.agent_role ?? 'Runtime conversacional',
        provider: config.provider ?? 'provider',
        model: config.model ?? 'modelo',
        tools: enabledTools,
        skills: enabledSkills as string[],
      })
      if (configResult.status === 'rejected' || toolsResult.status === 'rejected' || skillsResult.status === 'rejected') {
        setTopologyError('Parte da configuração do agente não pôde ser carregada. O mapa está a mostrar apenas o que foi possível confirmar.')
      }
    } catch {
      setTopologyError('Não foi possível carregar a configuração completa do agente.')
    }
  }, [])

  const loadRuns = useCallback(async () => {
    if (profileLoading) return
    if (!accountId) {
      setTelemetryError('Não foi possível identificar a conta actual.')
      setLoading(false)
      return
    }
    setLoading(true)
    setTelemetryError(null)
    try {
      const supabase = createClient()
      const { data, error: runsError } = await supabase
        .from('agent_traces')
        .select('id, conversation_id, intent, model_tier, final_action, status, provider, model, total_ms, started_at, finished_at, created_at')
        .eq('account_id', accountId)
        .order('started_at', { ascending: false })
        .limit(30)
      if (runsError) throw runsError
      const next = (data ?? []).map(normalizeLiveRun).filter((row): row is AgentLiveRun => Boolean(row))
      setRuns(next)
      const current = selectedRunIdRef.current
      const nextId = current && next.some((run) => run.id === current) ? current : (next[0]?.id ?? null)
      if (nextId !== current) selectRun(nextId, true)
    } catch (loadError) {
      setTelemetryError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as execuções do agente.')
    } finally {
      setLoading(false)
    }
  }, [accountId, profileLoading, selectRun])

  const loadSteps = useCallback(async (runId: string) => {
    if (!accountId) return
    const token = ++stepLoadTokenRef.current
    const supabase = createClient()
    const { data, error: stepsError } = await supabase
      .from('agent_trace_steps')
      .select('id, trace_id, sequence, type, label, status, started_at, finished_at, duration_ms, metadata')
      .eq('account_id', accountId)
      .eq('trace_id', runId)
      .order('sequence', { ascending: true })
    if (token !== stepLoadTokenRef.current || runId !== selectedRunIdRef.current) return
    if (stepsError) {
      setTelemetryError(stepsError.message)
      return
    }
    setSteps((data ?? []).map(normalizeLiveStep).filter((row): row is AgentLiveStep => Boolean(row)))
  }, [accountId])

  useEffect(() => { void Promise.all([loadRuns(), loadTopology()]) }, [loadRuns, loadTopology])

  useEffect(() => {
    if (selectedRunId) void loadSteps(selectedRunId)
    else setSteps([])
  }, [selectedRunId, loadSteps])

  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`agent-live-observability:${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'wacrm', table: 'agent_traces', filter: `account_id=eq.${accountId}` }, (payload) => {
        const row = normalizeLiveRun(payload.new)
        if (!row) return
        setRuns((current) => upsertLiveRun(current, row))
        if (payload.eventType === 'INSERT') {
          selectRun(row.id, true)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'wacrm', table: 'agent_trace_steps', filter: `account_id=eq.${accountId}` }, (payload) => {
        const row = normalizeLiveStep(payload.new)
        if (!row || row.trace_id !== selectedRunIdRef.current) return
        setSteps((current) => upsertLiveStep(current, row))
        setSelectedStep((current) => current?.id === row.id ? row : current)
      })
      .subscribe((status) => setIsConnected(status === 'SUBSCRIBED'))
    return () => {
      void supabase.removeChannel(channel)
      setIsConnected(false)
    }
  }, [accountId, selectRun])

  const topology = useMemo(
    () => buildPersistentTopology(topologyConfig, steps, selectedRun, reducedMotion, playbackPath, playbackCursor),
    [topologyConfig, steps, selectedRun, reducedMotion, playbackPath, playbackCursor],
  )
  const duration = selectedRun ? runDurationMs(selectedRun) : 0
  void tick

  const shellClass = cn('space-y-3', fullScreen && 'fixed inset-0 z-50 overflow-hidden bg-background p-4 sm:p-5')
  const canvasHeight = fullScreen ? 'h-[calc(100vh-122px)]' : 'h-[min(720px,calc(100vh-250px))] min-h-[580px]'

  return (
    <div className={shellClass}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Mapa do Agent Runtime</p>
            {selectedRun && <RunStatusBadge run={selectedRun} playbackActive={playbackActive} />}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {selectedRun
              ? `${selectedRun.provider ?? topologyConfig.provider} · ${selectedRun.model ?? topologyConfig.model} · ${formatDuration(duration)} · conversa ${selectedRun.conversation_id.slice(0, 8)}…`
              : `${topologyConfig.provider} · ${topologyConfig.model} · topologia permanente da conta`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isConnected ? 'secondary' : 'outline'}>
            <span className={cn('h-1.5 w-1.5 rounded-full', isConnected ? 'bg-emerald-500' : 'bg-muted-foreground')} />
            {isConnected ? 'Ao vivo' : 'A ligar'}
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /> Execuções</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => recenter(280)}><Route className="h-4 w-4" /> Centralizar</Button>
          <div className="flex rounded-lg border border-border p-0.5">
            <Button type="button" size="sm" variant={view === 'graph' ? 'secondary' : 'ghost'} onClick={() => setView('graph')}><Workflow className="h-4 w-4" /> Grafo</Button>
            <Button type="button" size="sm" variant={view === 'timeline' ? 'secondary' : 'ghost'} onClick={() => setView('timeline')}><List className="h-4 w-4" /> Timeline</Button>
          </div>
          <Button type="button" size="icon" variant="outline" onClick={() => setFullScreen((value) => !value)} aria-label={fullScreen ? 'Sair do ecrã inteiro' : 'Abrir em ecrã inteiro'}>
            {fullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {(telemetryError || topologyError) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <span>{telemetryError ?? topologyError}</span>
          <Button variant="ghost" size="sm" onClick={() => void Promise.all([loadRuns(), loadTopology()])}><RefreshCw className="h-3.5 w-3.5" /> Tentar novamente</Button>
        </div>
      )}

      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-muted/20">
        {loading && view === 'graph' ? (
          <div className={cn(canvasHeight, 'flex items-center justify-center text-sm text-muted-foreground')}>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> A montar o Agent Runtime…
          </div>
        ) : view === 'graph' ? (
          <div className={canvasHeight}>
            <ReactFlow
              nodes={topology.nodes}
              edges={topology.edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.08, minZoom: 0.5, maxZoom: 1 }}
              minZoom={0.35}
              maxZoom={1.7}
              onInit={(instance) => { flowRef.current = instance; recenter(0) }}
              onNodeClick={(_, node) => {
                const nodeId = (node.data as TopologyNodeData).topologyId
                const matching = [...steps].reverse().find((step) => topologyIdForStep(step, topologyConfig.tools) === nodeId)
                if (matching) setSelectedStep(matching)
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        ) : steps.length === 0 ? (
          <div className={cn(canvasHeight, 'flex items-center justify-center px-6 text-center text-sm text-muted-foreground')}>
            {selectedRun ? 'Esta execução ainda não tem passos observáveis registados.' : 'Ainda não existe uma execução para esta conta. O mapa do agente permanece disponível no modo Grafo.'}
          </div>
        ) : (
          <div className={cn(canvasHeight, 'overflow-y-auto p-3 sm:p-4')}>
            <ol className="mx-auto max-w-3xl space-y-2">
              {steps.map((step) => (
                <li key={step.id}>
                  <button type="button" onClick={() => setSelectedStep(step)} className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left hover:bg-muted/50">
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

      {!fullScreen && (
        <p className="text-xs text-muted-foreground">
          O runtime continua rápido. O percurso visual usa uma reprodução curta e desacoplada para permitir acompanhar cada nó sem atrasar a resposta enviada ao cliente.
        </p>
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Execuções recentes</SheetTitle>
            <SheetDescription>Seleccione um run para rever o percurso no mesmo mapa permanente.</SheetDescription>
          </SheetHeader>
          <div className="space-y-1 px-4 pb-6">
            {runs.length === 0 ? (
              <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                Ainda não existem execuções registadas. Pode abrir o Playground ou aguardar uma nova mensagem do WhatsApp.
                <Button className="mt-3 w-full" variant="outline" onClick={() => { setHistoryOpen(false); onOpenTab('playground') }}>Abrir Playground</Button>
              </div>
            ) : runs.map((run) => (
              <button key={run.id} type="button" onClick={() => { selectRun(run.id, true); setHistoryOpen(false) }} className={cn('w-full rounded-lg px-3 py-2.5 text-left transition-colors', run.id === selectedRun?.id ? 'bg-primary/10 text-foreground' : 'hover:bg-muted')}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{RUN_TIME_FORMATTER.format(new Date(run.started_at))}</span>
                  <span className={cn('ml-auto h-2 w-2 rounded-full', run.status === 'running' ? 'animate-pulse bg-primary motion-reduce:animate-none' : run.status === 'failed' ? 'bg-destructive' : run.status === 'blocked' ? 'bg-amber-500' : 'bg-emerald-500')} />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{run.intent ?? 'turno'} · {run.final_action}</p>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

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
                  <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Estado</p><p className="mt-1 text-sm font-medium">{STATUS_LABEL[selectedStep.status] ?? selectedStep.status}</p></div>
                  <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Duração</p><p className="mt-1 text-sm font-medium tabular-nums">{formatDuration(selectedStep.duration_ms)}</p></div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata sanitizada</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{metadataText(selectedStep.metadata ?? {})}</pre>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">Este inspector mostra apenas factos observáveis do runtime. O raciocínio privado do modelo não é guardado nem apresentado.</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

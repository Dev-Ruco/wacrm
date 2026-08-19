"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from "@/components/interactive/interactive-builder"
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

export interface BuilderStep {
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

interface StepMeta {
  label: string
  icon: typeof Zap
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "send_message", icon: MessageSquare, border: "border-l-primary" },
  send_buttons: { label: "send_buttons", icon: MousePointerClick, border: "border-l-primary" },
  send_list: { label: "send_list", icon: List, border: "border-l-primary" },
  send_template: { label: "send_template", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "add_tag", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "remove_tag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "assign_conversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "update_contact_field", icon: PencilLine, border: "border-l-primary" },
  create_deal: { label: "create_deal", icon: Briefcase, border: "border-l-primary" },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: { label: "condition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "send_webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "close_conversation", icon: CircleSlash, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "new_contact_created" },
  { value: "tag_added" },
]

const RETIRED_TRIGGER_TYPES = new Set<AutomationTriggerType>([
  "conversation_assigned",
  "time_based",
])

const CONVERSATION_COPY = {
  pt: {
    action: "Acção",
    wait: "Espera",
    condition: "Condição",
    messageMode: "Quem escreve a mensagem",
    agentMode: "Pedir ao Agente",
    fixedMode: "Texto fixo",
    agentInstruction: "Objectivo / instrução para o agente",
    agentPlaceholder: "Ex.: Retoma esta conversa naturalmente e responde ao pedido real do cliente. Não repitas perguntas já respondidas.",
    agentHint: "Usa o mesmo agente da conta, com identidade, contexto da conversa, CRM, memória, Knowledge, Skills, estratégia e ferramentas. Escreve o objectivo; não escrevas a resposta final ao cliente.",
    fixedText: "Texto da mensagem",
    fixedHint: "Envia exactamente este texto. Use apenas quando a mensagem precisa de ser determinística; para conversa normal, prefira Pedir ao Agente.",
    typing: "Mostrar «a escrever…» antes de enviar",
    typingHint: "Aplica uma pausa curta e proporcional antes de mensagens fixas conversacionais. Modelos oficiais do WhatsApp continuam imediatos.",
  },
  en: {
    action: "Action",
    wait: "Wait",
    condition: "Condition",
    messageMode: "Who writes the message",
    agentMode: "Ask the Agent",
    fixedMode: "Fixed text",
    agentInstruction: "Goal / instruction for the agent",
    agentPlaceholder: "E.g. Continue this conversation naturally and answer the customer's real request. Do not repeat answered questions.",
    agentHint: "Uses the same account agent with conversation context, CRM, memory, Knowledge, Skills, strategy and tools. Write the goal, not the final customer reply.",
    fixedText: "Message text",
    fixedHint: "Sends exactly this text. Use it when wording must be deterministic; for normal conversation prefer Ask the Agent.",
    typing: "Show typing before sending",
    typingHint: "Adds a short proportional pause before conversational fixed text. Official WhatsApp templates remain immediate.",
  },
} as const

function conversationCopy(locale: string) {
  return locale.toLowerCase().startsWith("pt") ? CONVERSATION_COPY.pt : CONVERSATION_COPY.en
}

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>
}
function asInteractive(cfg: Record<string, unknown>): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "", mode: "agent" }
    case "send_buttons":
      return toStepConfig(blankButtonsPayload())
    case "send_list":
      return toStepConfig(blankListPayload())
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase.from("message_templates").select("*").eq("status", "APPROVED").order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase.from("pipeline_stages").select("id, name, pipeline_id, position").order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Older deployments may not expose the members endpoint yet.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider value={{ tags, members, templates, customFields, pipelines, stages }}>
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

function TagSelect({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: ReturnType<typeof useTranslations> }) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return <Input placeholder={t("tags.placeholder")} value={value} onChange={(e) => onChange(e.target.value)} className="bg-muted text-foreground" />
  }
  const selected = tags.find((tag) => tag.id === value)
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: selected?.color ?? "transparent" }} aria-hidden />
      <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
        <option value="">{t("tags.select")}</option>
        {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        {value && !selected && <option value={value}>{t("tags.unknown", { id: value })}</option>}
      </select>
    </div>
  )
}

function ContactFieldSelect({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: ReturnType<typeof useTranslations> }) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom = customValue && customFields.some((field) => `custom:${field.id}` === customValue)
  return (
    <select value={value || "name"} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="name">{t("fields.name")}</option>
      <option value="email">{t("fields.email")}</option>
      <option value="company">{t("fields.company")}</option>
      {customFields.length > 0 && <optgroup label={t("fields.customFields")}>{customFields.map((field) => <option key={field.id} value={`custom:${field.id}`}>{field.field_name}</option>)}</optgroup>}
      {customValue && !knownCustom && <option value={customValue}>{t("fields.unknown", { id: customValue })}</option>}
    </select>
  )
}

function AgentSelect({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: ReturnType<typeof useTranslations> }) {
  const { members } = useResources()
  if (members.length === 0) {
    return <Input placeholder={t("agents.placeholder")} value={value} onChange={(e) => onChange(e.target.value)} className="bg-muted text-foreground" />
  }
  const selected = members.find((member) => member.user_id === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">{t("agents.select")}</option>
      {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || member.user_id}</option>)}
      {value && !selected && <option value={value}>{t("agents.unknown", { id: value })}</option>}
    </select>
  )
}

function DealPipelineFields({ pipelineId, stageId, onChange, t }: { pipelineId: string; stageId: string; onChange: (patch: { pipeline_id: string; stage_id: string }) => void; t: ReturnType<typeof useTranslations> }) {
  const { pipelines, stages } = useResources()
  if (pipelines.length === 0) {
    return <><FieldBlock label={t("pipelines.pipelineIdLabel")}><Input value={pipelineId} onChange={(e) => onChange({ pipeline_id: e.target.value, stage_id: stageId })} className="bg-muted text-foreground" /></FieldBlock><FieldBlock label={t("pipelines.stageIdLabel")}><Input value={stageId} onChange={(e) => onChange({ pipeline_id: pipelineId, stage_id: e.target.value })} className="bg-muted text-foreground" /></FieldBlock></>
  }
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === pipelineId)
  const stageOptions = stages.filter((stage) => stage.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((stage) => stage.id === stageId)
  return (
    <>
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <select value={pipelineId} onChange={(e) => { const nextPipelineId = e.target.value; const firstStage = stages.find((stage) => stage.pipeline_id === nextPipelineId); onChange({ pipeline_id: nextPipelineId, stage_id: firstStage?.id ?? "" }) }} className={SELECT_CLASS}>
          <option value="">{t("pipelines.selectPipeline")}</option>
          {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
          {pipelineId && !selectedPipeline && <option value={pipelineId}>{t("pipelines.unknownPipeline", { id: pipelineId })}</option>}
        </select>
      </FieldBlock>
      <FieldBlock label={t("pipelines.stageLabel")}>
        <select value={stageId} onChange={(e) => onChange({ pipeline_id: pipelineId, stage_id: e.target.value })} className={SELECT_CLASS} disabled={!pipelineId || stageOptions.length === 0}>
          <option value="">{pipelineId ? t("pipelines.selectStage") : t("pipelines.selectPipelineFirst")}</option>
          {stageOptions.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          {stageId && pipelineId && !selectedStage && <option value={stageId}>{t("pipelines.unknownStage", { id: stageId })}</option>}
        </select>
      </FieldBlock>
    </>
  )
}

function SendTemplateFields({ templateName, language, onChange, t }: { templateName: string; language: string; onChange: (patch: { template_name: string; language: string }) => void; t: ReturnType<typeof useTranslations> }) {
  const { templates } = useResources()
  if (templates.length === 0) {
    return <><FieldBlock label={t("templates.templateNameLabel")}><Input value={templateName} onChange={(e) => onChange({ template_name: e.target.value, language })} className="bg-muted text-foreground" /></FieldBlock><FieldBlock label={t("templates.languageLabel")}><Input value={language} onChange={(e) => onChange({ template_name: templateName, language: e.target.value })} className="bg-muted text-foreground" /></FieldBlock></>
  }
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some((template) => toValue(template.name, template.language ?? "en_US") === current)
  return (
    <FieldBlock label={t("templates.templateLabel")}>
      <select value={current} onChange={(e) => { const [name, lang] = e.target.value.split("::"); onChange({ template_name: name ?? "", language: lang ?? "" }) }} className={SELECT_CLASS}>
        <option value="">{t("templates.select")}</option>
        {templates.map((template) => { const lang = template.language ?? "en_US"; return <option key={template.id} value={toValue(template.name, lang)}>{template.name} ({lang})</option> })}
        {current && !hasMatch && <option value={current}>{t("templates.unknown", { name: templateName, lang: language || t("templates.unknownLang") })}</option>}
      </select>
    </FieldBlock>
  )
}

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  function updateStep(path: StepPath, updater: (step: BuilderStep) => BuilderStep) {
    setState((current) => ({ ...current, steps: mapAtPath(current.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = { cid: cid(), step_type: type, step_config: blankConfig(type), branches: type === "condition" ? { yes: [], no: [] } : undefined }
    setState((current) => ({ ...current, steps: insertAt(current.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((current) => ({ ...current, steps: removeAt(current.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((current) => ({ ...current, steps: moveAt(current.steps, path, direction) }))
  }

  async function save() {
    if (state.is_active && RETIRED_TRIGGER_TYPES.has(state.trigger_type)) {
      toast.error("Este gatilho ainda não tem execução activa no WACRM. Escolha outro gatilho antes de activar esta automação.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }
      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch(`/api/automations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const firstIssue: { path?: string; message?: string } | undefined = body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, { description: firstIssue.path ? `at ${firstIssue.path}` : undefined })
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) router.replace(`/automations/${body.automation.id}/edit`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button type="button" onClick={() => router.push("/automations")} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={t("backToAutomations")}><ArrowLeft className="h-4 w-4" /></button>
        <input value={state.name} onChange={(e) => patchTop("name", e.target.value)} placeholder={t("untitled")} className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">{t("active")}</span><Switch checked={state.is_active} onCheckedChange={(value) => patchTop("is_active", !!value)} aria-label={t("activeAria")} /></div>
        <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isEditing ? t("save") : t("saveDraft")}</Button>
      </header>

      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <TriggerCard type={state.trigger_type} config={state.trigger_config} onTypeChange={(value) => patchTop("trigger_type", value)} onConfigChange={(config) => patchTop("trigger_config", config)} t={t} />
            <StepList steps={state.steps} parentPath={[]} expandedId={expandedId} setExpandedId={setExpandedId} updateStep={updateStep} addStepAt={addStepAt} deleteStepAt={deleteStepAt} moveStepAt={moveStepAt} />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

function TriggerCard({ type, config, onTypeChange, onConfigChange, t }: { type: AutomationTriggerType; config: Record<string, unknown>; onTypeChange: (type: AutomationTriggerType) => void; onConfigChange: (config: Record<string, unknown>) => void; t: ReturnType<typeof useTranslations> }) {
  const [open, setOpen] = useState(false)
  const retired = RETIRED_TRIGGER_TYPES.has(type)
  return (
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400"><Zap className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] uppercase tracking-wide text-blue-300">{t("trigger")}</div><div className="truncate text-sm font-medium text-foreground">{t(`triggers.${type}.label`)}</div></div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("triggerType")}</label>
              <select value={type} onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none">
                {retired && <option value={type} disabled>{t(`triggers.${type}.label`)} — indisponível</option>}
                {TRIGGER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(`triggers.${option.value}.label`)}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">{retired ? "Este gatilho foi retirado de novas automações porque ainda não tem um dispatcher de produção." : t(`triggers.${type}.hint`)}</p>
            </div>
            {type === "keyword_match" && <KeywordMatchConfig config={config as unknown as KeywordMatchTriggerConfig} onChange={onConfigChange} t={t} />}
            {type === "interactive_reply" && <InteractiveReplyConfig config={config} onChange={onConfigChange} t={t} />}
            {type === "tag_added" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Tag</label><TagSelect value={(config.tag_id as string) ?? ""} onChange={(value) => onConfigChange({ ...config, tag_id: value })} t={t} /></div>}
            {type === "time_based" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("schedule")}</label><Input placeholder="Cron expression or HH:mm" value={(config.schedule as string) ?? ""} onChange={(e) => onConfigChange({ ...config, schedule: e.target.value })} className="bg-muted text-foreground" /><p className="mt-1 text-[11px] text-muted-foreground">{t("scheduleHint")}</p></div>}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({ config, onChange, t }: { config: KeywordMatchTriggerConfig; onChange: (config: Record<string, unknown>) => void; t: ReturnType<typeof useTranslations> }) {
  const keywords = config?.keywords ?? []
  const [draft, setDraft] = useState(keywords.join(", "))
  useEffect(() => {
    if (config?.match_type == null) onChange({ ...config, match_type: "contains" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function commit() {
    const parsed = draft.split(",").map((value) => value.trim()).filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }
  return (
    <div className="space-y-2">
      <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("keywords")}</label><Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }} placeholder={t("keywordsHint")} className="bg-muted text-foreground" /></div>
      <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("config.matchType")}</label><select value={config?.match_type ?? "contains"} onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" | "word" })} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"><option value="contains">{t("config.matchContains")}</option><option value="word">{t("config.matchWord")}</option><option value="exact">{t("config.matchExact")}</option></select>{config?.match_type === "word" && <p className="mt-1 text-xs text-muted-foreground">{t("config.matchWordHint")}</p>}</div>
    </div>
  )
}

function InteractiveReplyConfig({ config, onChange, t }: { config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void; t: ReturnType<typeof useTranslations> }) {
  const ids = (config?.reply_ids as string[] | undefined) ?? []
  const [draft, setDraft] = useState(ids.join(", "))
  function commit() {
    const parsed = draft.split(",").map((value) => value.trim()).filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, reply_ids: parsed })
  }
  return <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("replyIds")}</label><Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }} placeholder={t("replyIdsHint")} className="bg-muted font-mono text-foreground" /><p className="mt-1 text-[11px] text-muted-foreground">{t("replyIdsHelp")}</p></div>
}

type ParentScope = { kind: "root" } | { kind: "branch"; parentCid: string; branch: "yes" | "no" }
type StepPath = ({ kind: "root"; index: number } | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number })[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (step: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  const parentScope: ParentScope = parentPath.length === 0 ? { kind: "root" } : (() => { const last = parentPath[parentPath.length - 1]; if (last.kind !== "branch") return { kind: "root" } as const; return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const })()
  return <div className="flex flex-col items-center"><AddButton onPick={(type) => props.addStepAt(parentScope, 0, type)} />{steps.map((step, index) => <StepRenderer key={step.cid} step={step} index={index} total={steps.length} parentScope={parentScope} parentPath={parentPath} {...rest} />)}</div>
}

function StepRenderer({ step, index, total, parentScope, parentPath, ...props }: { step: BuilderStep; index: number; total: number; parentScope: ParentScope; parentPath: StepPath } & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("Automations.builder")
  const locale = useLocale()
  const copy = conversationCopy(locale)
  const path: StepPath = [...parentPath, parentScope.kind === "root" ? { kind: "root", index } : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index }]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  const kindLabel = isCondition ? copy.condition : step.step_type === "wait" ? copy.wait : copy.action
  const width = isCondition ? "w-full max-w-[400px] sm:w-[400px]" : "w-full max-w-[320px] sm:w-80"
  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
        <div className={cn("rounded-lg border border-border border-l-4 bg-card shadow-lg", meta.border)}>
          <button type="button" onClick={() => props.setExpandedId(expanded ? null : step.cid)} className="flex w-full items-center gap-3 px-4 py-3 text-left"><GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden /><div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{kindLabel}</div><div className="truncate text-sm font-medium text-foreground">{t(`steps.${meta.label}`)}</div><div className="truncate text-[11px] text-muted-foreground">{previewFor(step)}</div></div><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} /></button>
          {expanded && <div className="border-t border-border px-4 py-3"><StepEditor step={step} onChange={(next) => props.updateStep(path, () => next)} /><div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3"><div className="flex gap-1"><Button variant="ghost" size="icon" disabled={index === 0} aria-label="Move up" onClick={() => props.moveStepAt(path, -1)}><ArrowUp className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={index === total - 1} aria-label="Move down" onClick={() => props.moveStepAt(path, 1)}><ArrowDown className="h-4 w-4" /></Button></div><Button variant="destructive" size="sm" onClick={() => props.deleteStepAt(path)}><Trash2 className="h-3.5 w-3.5" />{t("delete", { defaultValue: "Delete" })}</Button></div></div>}
        </div>
        {isCondition && <ConditionBranches step={step} parentPath={path} {...props} />}
      </div>
      {!isCondition && <AddButton onPick={(type) => props.addStepAt(parentScope, index + 1, type)} />}
    </>
  )
}

function ConditionBranches({ step, parentPath, ...props }: { step: BuilderStep; parentPath: StepPath } & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("Automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  const yesPath: StepPath = [...parentPath, { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 }]
  const noPath: StepPath = [...parentPath, { kind: "branch", parentCid: step.cid, branch: "no", index: 0 }]
  return <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><BranchColumn label={t("branches.yes")} color="text-primary"><StepList {...props} steps={yes} parentPath={yesPath} /></BranchColumn><BranchColumn label={t("branches.no")} color="text-rose-400"><StepList {...props} steps={no} parentPath={noPath} /></BranchColumn></div>
}

function BranchColumn({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return <div className="flex flex-col items-center"><div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>{children}</div>
}

function AddButton({ onPick }: { onPick: (type: AutomationStepType) => void }) {
  const t = useTranslations("Automations.builder")
  return <div className="relative flex flex-col items-center"><div className="h-4 w-[2px] bg-border" aria-hidden /><DropdownMenu><DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary" aria-label={t("addStep")}><Plus className="h-4 w-4" /></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover">{ADDABLE_STEPS.map((type) => { const Icon = STEP_META[type].icon; return <DropdownMenuItem key={type} onClick={() => onPick(type)}><Icon className="h-4 w-4" />{t(`steps.${STEP_META[type].label}`)}</DropdownMenuItem> })}</DropdownMenuContent></DropdownMenu><div className="h-4 w-[2px] bg-border" aria-hidden /></div>
}

function StepEditor({ step, onChange }: { step: BuilderStep; onChange: (step: BuilderStep) => void }) {
  const t = useTranslations("Automations.builder")
  const locale = useLocale()
  const copy = conversationCopy(locale)
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) => onChange({ ...step, step_config: { ...cfg, ...patch } })
  switch (step.step_type) {
    case "send_message": {
      const mode = cfg.mode === "agent" ? "agent" : "fixed"
      return <div className="space-y-3"><FieldBlock label={copy.messageMode}><select value={mode} onChange={(e) => set({ mode: e.target.value })} className={SELECT_CLASS}><option value="agent">{copy.agentMode}</option><option value="fixed">{copy.fixedMode}</option></select></FieldBlock>{mode === "agent" ? <><FieldBlock label={copy.agentInstruction}><Textarea value={(cfg.text as string) ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder={copy.agentPlaceholder} className="min-h-28 bg-muted text-foreground" /></FieldBlock><p className="text-xs leading-relaxed text-muted-foreground">{copy.agentHint}</p></> : <><FieldBlock label={copy.fixedText}><Textarea value={(cfg.text as string) ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder={t("config.placeholderMessageText")} className="min-h-24 bg-muted text-foreground" /></FieldBlock><p className="text-xs leading-relaxed text-muted-foreground">{copy.fixedHint}</p><div className="flex items-start justify-between gap-4 rounded-md border border-border p-3"><div><p className="text-xs font-medium text-foreground">{copy.typing}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{copy.typingHint}</p></div><Switch checked={cfg.humanize !== false} onCheckedChange={(value) => set({ humanize: !!value })} /></div></>}</div>
    }
    case "send_buttons":
    case "send_list":
      return <InteractiveBuilder value={asInteractive(cfg)} onChange={(payload) => onChange({ ...step, step_config: toStepConfig(payload) })} />
    case "send_template":
      return <SendTemplateFields templateName={(cfg.template_name as string) ?? ""} language={(cfg.language as string) ?? ""} onChange={(patch) => set(patch)} t={t} />
    case "add_tag":
    case "remove_tag":
      return <FieldBlock label={t("config.tagLabel")}><TagSelect value={(cfg.tag_id as string) ?? ""} onChange={(value) => set({ tag_id: value })} t={t} /></FieldBlock>
    case "assign_conversation":
      return <><FieldBlock label={t("config.modeLabel")}><select value={(cfg.mode as string) ?? "round_robin"} onChange={(e) => set({ mode: e.target.value })} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"><option value="round_robin">{t("config.modes.round_robin")}</option><option value="specific">{t("config.modes.specific")}</option></select></FieldBlock>{cfg.mode === "specific" && <FieldBlock label={t("config.agentLabel")}><AgentSelect value={(cfg.agent_id as string) ?? ""} onChange={(value) => set({ agent_id: value })} t={t} /></FieldBlock>}</>
    case "update_contact_field":
      return <><FieldBlock label={t("config.fieldLabel")}><ContactFieldSelect value={(cfg.field as string) ?? "name"} onChange={(value) => set({ field: value })} t={t} /></FieldBlock><FieldBlock label={t("config.valueLabel")}><Input value={(cfg.value as string) ?? ""} onChange={(e) => set({ value: e.target.value })} placeholder={t.raw("config.placeholderValue")} className="bg-muted text-foreground" /></FieldBlock></>
    case "create_deal":
      return <><DealPipelineFields pipelineId={(cfg.pipeline_id as string) ?? ""} stageId={(cfg.stage_id as string) ?? ""} onChange={(patch) => set(patch)} t={t} /><FieldBlock label={t("config.titleLabel")}><Input value={(cfg.title as string) ?? ""} onChange={(e) => set({ title: e.target.value })} className="bg-muted text-foreground" /></FieldBlock><FieldBlock label={t("config.valueLabel")}><Input type="number" value={(cfg.value as number) ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} className="bg-muted text-foreground" /></FieldBlock></>
    case "wait":
      return <div className="grid grid-cols-2 gap-2"><FieldBlock label={t("config.amountLabel")}><Input type="number" min={1} value={(cfg.amount as number) ?? 1} onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })} className="bg-muted text-foreground" /></FieldBlock><FieldBlock label={t("config.unitLabel")}><select value={(cfg.unit as string) ?? "hours"} onChange={(e) => set({ unit: e.target.value })} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"><option value="minutes">{t("config.units.minutes")}</option><option value="hours">{t("config.units.hours")}</option><option value="days">{t("config.units.days")}</option></select></FieldBlock></div>
    case "condition":
      return <><FieldBlock label={t("config.subjectLabel")}><select value={(cfg.subject as string) ?? "tag_presence"} onChange={(e) => set({ subject: e.target.value })} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"><option value="tag_presence">{t("config.subjects.tag_presence")}</option><option value="contact_field">{t("config.subjects.contact_field")}</option><option value="message_content">{t("config.subjects.message_content")}</option><option value="time_of_day">{t("config.subjects.time_of_day")}</option></select></FieldBlock><FieldBlock label={t("config.operandLabel")}><Input placeholder={cfg.subject === "time_of_day" ? t("config.placeholderTime") : cfg.subject === "contact_field" ? t("config.placeholderContact") : cfg.subject === "tag_presence" ? t("config.placeholderTag") : ""} value={(cfg.operand as string) ?? ""} onChange={(e) => set({ operand: e.target.value })} className="bg-muted text-foreground" /></FieldBlock>{(cfg.subject === "contact_field" || cfg.subject === "message_content") && <FieldBlock label={t("config.valueLabel")}><Input value={(cfg.value as string) ?? ""} onChange={(e) => set({ value: e.target.value })} className="bg-muted text-foreground" /></FieldBlock>}</>
    case "send_webhook":
      return <><FieldBlock label={t("config.urlLabel")}><Input value={(cfg.url as string) ?? ""} onChange={(e) => set({ url: e.target.value })} className="bg-muted text-foreground" /></FieldBlock><FieldBlock label={t("config.bodyTemplateLabel")}><Textarea value={(cfg.body_template as string) ?? ""} onChange={(e) => set({ body_template: e.target.value })} className="min-h-20 bg-muted font-mono text-xs text-foreground" /></FieldBlock></>
    case "close_conversation":
      return <p className="text-xs text-muted-foreground">{t("config.closeConversationHint", { defaultValue: "Sets the conversation status to \"closed\". No configuration needed." })}</p>
    default:
      return null
  }
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-2 last:mb-0"><label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message": return (step.step_config.text as string) || "no text yet"
    case "send_buttons":
    case "send_list": return interactivePayloadPreviewText(asInteractive(step.step_config)) || "no body yet"
    case "send_template": return (step.step_config.template_name as string) || "pick a template"
    case "wait": return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition": return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook": return (step.step_config.url as string) || "no url"
    default: return ""
  }
}

function insertAt(steps: BuilderStep[], parent: ParentScope, index: number, node: BuilderStep): BuilderStep[] {
  if (parent.kind === "root") { const copy = [...steps]; copy.splice(index, 0, node); return copy }
  return steps.map((step) => { if (step.cid !== parent.parentCid || !step.branches) return step; const list = [...step.branches[parent.branch]]; list.splice(index, 0, node); return { ...step, branches: { ...step.branches, [parent.branch]: list } } })
}

function mapAtPath(steps: BuilderStep[], path: StepPath, updater: (step: BuilderStep) => BuilderStep): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") return steps.map((step, index) => index !== head.index ? step : rest.length === 0 ? updater(step) : { ...step, branches: walkBranches(step.branches, rest, updater) })
  return steps.map((step) => { if (step.cid !== head.parentCid || !step.branches) return step; const bucket = step.branches[head.branch]; const updated = bucket.map((child, index) => index !== head.index ? child : rest.length === 0 ? updater(child) : { ...child, branches: walkBranches(child.branches, rest, updater) }); return { ...step, branches: { ...step.branches, [head.branch]: updated } } })
}

function walkBranches(branches: BuilderStep["branches"], path: StepPath, updater: (step: BuilderStep) => BuilderStep): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, index) => index !== head.index ? child : rest.length === 0 ? updater(child) : { ...child, branches: walkBranches(child.branches, rest, updater) })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") { if (rest.length === 0) return steps.filter((_, index) => index !== head.index); return steps.map((step, index) => index !== head.index ? step : { ...step, branches: removeFromBranches(step.branches, rest) }) }
  return steps.map((step) => { if (step.cid !== head.parentCid || !step.branches) return step; const bucket = step.branches[head.branch]; const next = rest.length === 0 ? bucket.filter((_, index) => index !== head.index) : bucket.map((child, index) => index !== head.index ? child : { ...child, branches: removeFromBranches(child.branches, rest) }); return { ...step, branches: { ...step.branches, [head.branch]: next } } })
}

function removeFromBranches(branches: BuilderStep["branches"], path: StepPath): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next = rest.length === 0 ? bucket.filter((_, index) => index !== head.index) : bucket.map((child, index) => index !== head.index ? child : { ...child, branches: removeFromBranches(child.branches, rest) })
  return { ...branches, [head.branch]: next }
}

function moveAt(steps: BuilderStep[], path: StepPath, direction: -1 | 1): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(array: T[], index: number) => { const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= array.length) return array; const copy = [...array]; [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]]; return copy }
  if (head.kind === "root") { if (rest.length === 0) return swap(steps, head.index); return steps.map((step, index) => index !== head.index ? step : { ...step, branches: moveInBranches(step.branches, rest, direction) }) }
  return steps.map((step) => { if (step.cid !== head.parentCid || !step.branches) return step; const bucket = step.branches[head.branch]; const next = rest.length === 0 ? swap(bucket, head.index) : bucket; return { ...step, branches: { ...step.branches, [head.branch]: next } } })
}

function moveInBranches(branches: BuilderStep["branches"], path: StepPath, direction: -1 | 1): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(array: T[], index: number) => { const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= array.length) return array; const copy = [...array]; [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]]; return copy }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((step) => ({ step_type: step.step_type, step_config: step.step_config, branches: step.branches ? { yes: toApiSteps(step.branches.yes), no: toApiSteps(step.branches.no) } : undefined }))
}

export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((node) => ({ cid: cid(), step_type: node.step_type as AutomationStepType, step_config: node.step_config ?? {}, branches: node.step_type === "condition" ? { yes: fromServerSteps(node.branches?.yes ?? []), no: fromServerSteps(node.branches?.no ?? []) } : undefined }))
}

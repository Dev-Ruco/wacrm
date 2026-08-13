'use client';

import { Loader2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentConfigState } from './use-agent-config';

export function AgentIdentity({ state }: { state: AgentConfigState }) {
  const { t } = state;
  const disabled = !state.canEdit || state.saving;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 text-primary" /> Identidade
          </CardTitle>
          <CardDescription>
            Quem é este agente. Estes campos ajudam o modelo a apresentar-se e a equipa a
            identificar o agente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Nome do agente</Label>
              <Input id="agent-name" value={state.agentName} onChange={(e) => state.setAgentName(e.target.value)} placeholder="Ex.: Assistente Digital" disabled={disabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-role">Função</Label>
              <Input id="agent-role" value={state.agentRole} onChange={(e) => state.setAgentRole(e.target.value)} placeholder="Ex.: Assistente Comercial" disabled={disabled} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-language">Idioma principal</Label>
              <Input id="agent-language" value={state.agentLanguage} onChange={(e) => state.setAgentLanguage(e.target.value)} placeholder="Ex.: Português" disabled={disabled} />
              <p className="text-xs text-muted-foreground">Usado apenas quando o idioma do cliente é ambíguo.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-description">Descrição interna</Label>
              <Input id="agent-description" value={state.agentDescription} onChange={(e) => state.setAgentDescription(e.target.value)} placeholder="Nota interna para a equipa" disabled={disabled} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-base">{t('behaviour')}</CardTitle>
          <CardDescription>{t('behaviourDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
            <Textarea id="ai-prompt" value={state.systemPrompt} onChange={(e) => state.setSystemPrompt(e.target.value)} placeholder={t('promptPlaceholder')} rows={6} disabled={disabled} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-base">Estratégia de conversa e venda</CardTitle>
          <CardDescription>
            Política desta conta. Cada empresa pode ter um comportamento diferente sem alterar o motor comum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label htmlFor="ai-initiative-mode">Modo de iniciativa</Label>
            <p className="text-xs text-muted-foreground">Define quando o agente deve esclarecer antes de executar acções.</p>
            <Select value={state.initiativeMode} onValueChange={(value) => state.setInitiativeMode(value as typeof state.initiativeMode)} disabled={disabled}>
              <SelectTrigger id="ai-initiative-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conversation_first">Conversacional — compreender antes de agir</SelectItem>
                <SelectItem value="balanced">Equilibrado — agir quando o objectivo está claro</SelectItem>
                <SelectItem value="action_first">Proactivo — avançar rapidamente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-max-products">Máximo de opções apresentadas</Label>
              <p className="text-xs text-muted-foreground">Limita a quantidade de opções mostradas de cada vez.</p>
            </div>
            <Input id="ai-max-products" type="number" min={1} max={10} value={state.maxProducts} onChange={(e) => state.setMaxProducts(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} disabled={disabled} className="w-20" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Apresentação visual automática</p>
              <p className="text-xs text-muted-foreground">Quando desligado, a conversa fica primeiro em texto e a apresentação visual só é usada quando o cliente a pede.</p>
            </div>
            <Switch checked={state.preferVisual} onCheckedChange={state.setPreferVisual} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Recomendações automáticas</p>
              <p className="text-xs text-muted-foreground">Recomenda apenas quando a necessidade do cliente já está suficientemente clara.</p>
            </div>
            <Switch checked={state.autoRecommend} onCheckedChange={state.setAutoRecommend} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Confirmar stock</p>
              <p className="text-xs text-muted-foreground">Consulta o stock antes de confirmar disponibilidade.</p>
            </div>
            <Switch checked={state.checkStock} onCheckedChange={state.setCheckStock} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Manter item seleccionado</p>
              <p className="text-xs text-muted-foreground">Mantém o item escolhido até o cliente o rejeitar ou mudar de assunto.</p>
            </div>
            <Switch checked={state.keepSelectedProduct} onCheckedChange={state.setKeepSelectedProduct} disabled={disabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-qualification-order">Ordem de qualificação</Label>
            <p className="text-xs text-muted-foreground">Para contas de catálogo que usam tamanho e cor.</p>
            <Select value={state.qualificationOrder} onValueChange={(value) => state.setQualificationOrder(value as typeof state.qualificationOrder)} disabled={disabled}>
              <SelectTrigger id="ai-qualification-order"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="size_then_color">Tamanho → cor</SelectItem>
                <SelectItem value="color_then_size">Cor → tamanho</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void state.handleSave()} disabled={disabled}>
          {state.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AgentTools } from '@/components/agents/agent-tools';
import { AgentSkills } from '@/components/agents/agent-skills';
import { AgentFlowPanel } from '@/components/agents/agent-flow-panel';
import { AgentFlowErrorBoundary } from '@/components/agents/agent-flow-error-boundary';
import { AgentSuggestions } from '@/components/agents/agent-suggestions';
import { AgentEval } from '@/components/agents/agent-eval';
import { AgentOverview } from '@/components/agents/agent-overview';
import { AgentIdentity } from '@/components/agents/agent-identity';
import { AgentRuntime } from '@/components/agents/agent-runtime';
import { AgentSecurity } from '@/components/agents/agent-security';
import { AgentMemory } from '@/components/agents/agent-memory';
import { AiKnowledgeCard } from '@/components/settings/ai-knowledge';
import { useAgentConfig } from '@/components/agents/use-agent-config';
import {
  AgentBuilderShell,
  type Section,
} from '@/components/agents/agent-builder-shell';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

const SECTIONS = new Set<Section>([
  'overview',
  'identity',
  'skills',
  'tools',
  'knowledge',
  'memory',
  'security',
  'runtime',
  'playground',
  'flow',
  'suggestions',
  'eval',
  'usage',
]);

function requestedSection(): Section | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('section');
  return value && SECTIONS.has(value as Section) ? (value as Section) : null;
}

export default function AgentsPage() {
  const { accountId, accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [section, setSection] = useState<Section>('overview');
  const [decided, setDecided] = useState(false);
  const agentConfig = useAgentConfig();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deepLink = requestedSection();
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setSection(deepLink ?? (data?.configured ? 'overview' : 'identity'));
        }
      } catch {
        if (!cancelled) setSection(deepLink ?? 'identity');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const renderSection = () => {
    switch (section) {
      case 'overview':
        return <AgentOverview state={agentConfig} onNavigate={setSection} />;
      case 'identity':
        return <AgentIdentity state={agentConfig} />;
      case 'skills':
        return <AgentSkills />;
      case 'tools':
        return <AgentTools />;
      case 'knowledge':
        return (
          <AiKnowledgeCard
            accountId={accountId}
            canEdit={agentConfig.canEdit}
            hasEmbeddingsKey={
              agentConfig.embeddingsKeyEdited
                ? agentConfig.embeddingsKey.trim().length > 0
                : agentConfig.hasStoredEmbeddingsKey
            }
          />
        );
      case 'memory':
        return <AgentMemory />;
      case 'security':
        return <AgentSecurity state={agentConfig} />;
      case 'runtime':
        return <AgentRuntime state={agentConfig} />;
      case 'playground':
        return <AiPlayground onGoToSetup={() => setSection('runtime')} />;
      case 'flow':
        return (
          <AgentFlowErrorBoundary>
            <AgentFlowPanel onOpenTab={(next) => setSection(next)} />
          </AgentFlowErrorBoundary>
        );
      case 'suggestions':
        return <AgentSuggestions />;
      case 'eval':
        return canViewUsage ? <AgentEval /> : null;
      case 'usage':
        return canViewUsage ? <AiUsageCard /> : null;
      default:
        return null;
    }
  };

  return (
    <div>
      {decided && (
        <AgentBuilderShell
          active={section}
          onNavigate={setSection}
          agentName={agentConfig.agentName}
          agentRole={agentConfig.agentRole}
          isActive={agentConfig.isActive}
          canToggleActive={false}
          canViewUsage={canViewUsage}
        >
          {renderSection()}
        </AgentBuilderShell>
      )}
    </div>
  );
}

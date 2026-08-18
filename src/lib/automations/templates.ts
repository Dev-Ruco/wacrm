import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  /** Stable English fallback only. UI copy is localized by slug. */
  name: string
  /** Stable English fallback only. UI copy is localized by slug. */
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

function agentMessage(
  instruction: string,
  options?: { onlyIfNoCustomerReplySinceStart?: boolean },
): AutomationStepConfig {
  // These fields live inside existing JSON step_config. Older send_message
  // rows remain valid and no tenant-specific schema is introduced.
  return {
    text: instruction,
    mode: 'agent',
    ...(options?.onlyIfNoCustomerReplySinceStart
      ? { only_if_no_customer_reply_since_start: true }
      : {}),
  } as AutomationStepConfig
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Smart First Contact',
    description: 'Let the account agent handle a first contact naturally instead of sending a canned greeting.',
    // Works for contacts created by WhatsApp as well as contacts imported or
    // created manually before their first real inbound conversation.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: agentMessage(
          [
            'This is the first inbound contact from this customer.',
            'Respond to what the customer actually said; do not recite a generic welcome script.',
            'Greet naturally and briefly when appropriate. You may use the customer name from CRM/WhatsApp when it is reliable and sounds natural, but do not force the name into every greeting.',
            'If the first message already contains a request or buying intent, answer that request immediately instead of asking a redundant “how can I help?”.',
            'Use the account identity, language, Knowledge, Skills, memory, CRM context and tools exactly as in any normal agent turn.',
          ].join(' '),
        ),
      },
    ],
  },

  out_of_office: {
    slug: 'out_of_office',
    name: 'After-hours Agent',
    description: 'Keep the autonomous agent useful after hours and mention human/physical availability only when it matters.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: agentMessage(
          [
            'The customer contacted the business outside the configured human/physical service window.',
            'Continue helping autonomously with everything the agent can genuinely do now.',
            'Do not send a generic “we are offline” message if you can answer the customer’s request.',
            'Mention human staff hours or physical-location availability only when the requested action truly requires a person or an open location.',
            'Never promise an action that the available tools cannot confirm.',
          ].join(' '),
        ),
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },

  // Kept for backwards compatibility with existing deep links. This template
  // remains keyword-driven because the automation engine does not yet expose a
  // semantic-intent trigger. It is deliberately not shown in the recommended
  // quick-start menu until that trigger exists.
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Legacy keyword-based lead qualification template.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: agentMessage(
          'The customer appears to have commercial interest. Continue the current conversation naturally and ask only the minimum useful qualification question that is still missing. Do not restart the conversation or ask for information the customer already provided.',
        ),
      },
    ],
  },

  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Contextual Follow-up',
    description: 'Re-open a quiet conversation through the same account agent instead of a canned reminder.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: agentMessage(
          [
            'This automation is a follow-up checkpoint after a period of inactivity.',
            'Read the full recent conversation and CRM state before deciding what to say.',
            'If the request is resolved, a human has taken over, or another message would be unnecessary, do not manufacture a follow-up.',
            'If a follow-up is still useful, continue from the exact open topic in a brief, low-pressure way. Refer naturally to the relevant product, service, question or next step rather than sending a generic “just checking in” message.',
          ].join(' '),
          { onlyIfNoCustomerReplySinceStart: true },
        ),
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

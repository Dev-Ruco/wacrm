import type {
  Automation,
  InteractiveReplyTriggerConfig,
  KeywordMatchTriggerConfig,
  TagTriggerConfig,
} from '@/types'

/**
 * Lightweight event context used to decide whether an automation trigger
 * matches. `conversation_id` is carried by message-trigger callers even though
 * the current deterministic predicates do not need to inspect it yet.
 */
export interface AutomationMatchContext {
  message_text?: string
  conversation_id?: string
  tag_id?: string
  interactive_reply_id?: string
}

/** Letter, digit or underscore in any script — the "inside a word" test. */
const WORD_CHAR = '[\\p{L}\\p{N}_]'

/**
 * Unicode-aware whole-word keyword matching. Account-authored keywords are
 * escaped so punctuation and regular-expression characters stay literal.
 */
export function matchesWholeWord(
  text: string,
  keyword: string,
  caseSensitive = false,
): boolean {
  if (!keyword) return false
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu',
  )
  return pattern.test(text)
}

export function triggerMatches(
  automation: Automation,
  ctx: AutomationMatchContext | undefined,
): boolean {
  if (automation.trigger_type === 'keyword_match') {
    const cfg = automation.trigger_config as KeywordMatchTriggerConfig
    if (!cfg?.keywords || cfg.keywords.length === 0) return false
    const text = (ctx?.message_text ?? '').toString()
    if (!text) return false
    if (cfg.match_type === 'word') {
      return cfg.keywords.some((raw) =>
        matchesWholeWord(text, raw, cfg.case_sensitive),
      )
    }
    const haystack = cfg.case_sensitive ? text : text.toLowerCase()
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase()
      return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
    })
  }

  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig
    const replyId = ctx?.interactive_reply_id
    if (!replyId || !Array.isArray(cfg?.reply_ids) || cfg.reply_ids.length === 0) {
      return false
    }
    return cfg.reply_ids.includes(replyId)
  }

  if (automation.trigger_type === 'tag_added') {
    const cfg = automation.trigger_config as TagTriggerConfig
    const tagId = ctx?.tag_id
    return Boolean(tagId && cfg?.tag_id && cfg.tag_id === tagId)
  }

  return true
}

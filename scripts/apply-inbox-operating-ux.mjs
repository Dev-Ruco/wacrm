import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index === -1) throw new Error(`Missing marker: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing start marker: ${label}`);
  const end = content.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Missing end marker: ${label}`);
  return content.slice(0, start) + replacement + content.slice(end);
}

// ---------------------------------------------------------------------------
// Message thread: put the operating mode next to the conversation header,
// stop force-scrolling agents who are reading history, and surface a compact
// "new messages" affordance instead.
// ---------------------------------------------------------------------------
{
  const path = 'src/components/inbox/message-thread.tsx';
  let content = read(path);

  content = replaceOnce(
    content,
    '  ArrowLeft,\n  RefreshCw,',
    '  ArrowLeft,\n  ArrowDown,\n  RefreshCw,',
    'message-thread ArrowDown import'
  );

  content = replaceOnce(
    content,
    '  const [loading, setLoading] = useState(false);\n  const scrollRef = useRef<HTMLDivElement>(null);',
    '  const [loading, setLoading] = useState(false);\n  const scrollRef = useRef<HTMLDivElement>(null);\n  const [showNewMessages, setShowNewMessages] = useState(false);\n  const previousMessageCountRef = useRef(0);',
    'message-thread scroll state'
  );

  content = replaceOnce(
    content,
    '  // Auto-scroll to bottom on new messages\n  useEffect(() => {\n    if (scrollRef.current) {\n      const el = scrollRef.current;\n      el.scrollTop = el.scrollHeight;\n    }\n  }, [messages]);',
    `  const scrollToLatest = useCallback(() => {\n    const el = scrollRef.current;\n    if (!el) return;\n    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });\n    setShowNewMessages(false);\n  }, []);\n\n  const handleThreadScroll = useCallback(() => {\n    const el = scrollRef.current;\n    if (!el) return;\n    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;\n    if (distanceFromBottom < 80) setShowNewMessages(false);\n  }, []);\n\n  // Follow the conversation only while the operator is already near the end.\n  // If they are reading history, keep their position and show a compact\n  // new-message pill instead of snapping the viewport away from their work.\n  useEffect(() => {\n    const el = scrollRef.current;\n    if (!el) return;\n\n    const previousCount = previousMessageCountRef.current;\n    const hasNewMessages = messages.length > previousCount;\n    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;\n    const shouldFollow = previousCount === 0 || distanceFromBottom < 160;\n    previousMessageCountRef.current = messages.length;\n\n    if (shouldFollow) {\n      requestAnimationFrame(() => {\n        const current = scrollRef.current;\n        if (current) current.scrollTop = current.scrollHeight;\n      });\n      // eslint-disable-next-line react-hooks/set-state-in-effect\n      setShowNewMessages(false);\n    } else if (hasNewMessages) {\n      // eslint-disable-next-line react-hooks/set-state-in-effect\n      setShowNewMessages(true);\n    }\n  }, [messages]);`,
    'message-thread smart auto-scroll'
  );

  content = replaceOnce(
    content,
    '  useEffect(() => {\n    setReplyTo(null);\n  }, [conversationId]);',
    `  useEffect(() => {\n    setReplyTo(null);\n    previousMessageCountRef.current = 0;\n    setShowNewMessages(false);\n  }, [conversationId]);`,
    'message-thread conversation reset'
  );

  const bannerBlock = `      {/* AI auto-reply banner — take over an active bot, or resume it\n          after a handoff. Renders nothing unless the account has\n          auto-reply configured. */}\n      <AiThreadBanner\n        conversationId={conversation.id}\n        disabled={conversation.ai_autoreply_disabled ?? false}\n        handoffSummary={conversation.ai_handoff_summary}\n        assignedAgentId={assignedAgentId}\n        currentUserId={user?.id}\n        onChange={(patch) => {\n          if (\"assigned_agent_id\" in patch) {\n            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);\n          }\n        }}\n      />\n\n`;

  content = replaceOnce(
    content,
    bannerBlock,
    '',
    'message-thread old AI banner position'
  );

  const headerEnd = '        </div>\n      </div>\n\n      {/* Messages Area */}';
  const headerWithMode = `        </div>\n      </div>\n\n      {/* Operating mode belongs with conversation context, not the composer. */}\n      <AiThreadBanner\n        conversationId={conversation.id}\n        disabled={conversation.ai_autoreply_disabled ?? false}\n        handoffSummary={conversation.ai_handoff_summary}\n        assignedAgentId={assignedAgentId}\n        currentUserId={user?.id}\n        onChange={(patch) => {\n          if ('assigned_agent_id' in patch) {\n            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);\n          }\n        }}\n      />\n\n      {/* Messages Area */}`;

  content = replaceOnce(
    content,
    headerEnd,
    headerWithMode,
    'message-thread insert AI mode after header'
  );

  content = replaceOnce(
    content,
    '<div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">',
    '<div ref={scrollRef} onScroll={handleThreadScroll} className="flex-1 overflow-y-auto px-4 py-4">',
    'message-thread scroll handler'
  );

  content = replaceOnce(
    content,
    '<div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>',
    '<div className={cn("relative flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>',
    'message-thread relative root'
  );

  content = replaceOnce(
    content,
    '      {/* Composer */}\n      <MessageComposer',
    `      {showNewMessages ? (\n        <button\n          type="button"\n          onClick={scrollToLatest}\n          className="border-border bg-card hover:bg-muted absolute bottom-[78px] left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors"\n        >\n          <ArrowDown className="size-3.5" />\n          Novas mensagens\n        </button>\n      ) : null}\n\n      {/* Composer */}\n      <MessageComposer`,
    'message-thread new message pill'
  );

  write(path, content);
}

// ---------------------------------------------------------------------------
// Composer: one action menu, explicit AI affordance, per-conversation drafts,
// cleaner field chrome and no permanent tutorial hint.
// ---------------------------------------------------------------------------
{
  const path = 'src/components/inbox/message-composer.tsx';
  let content = read(path);

  content = replaceOnce(
    content,
    '  LayoutTemplate,\n  Paperclip,\n  Image as ImageIcon,',
    '  LayoutTemplate,\n  Image as ImageIcon,',
    'composer remove Paperclip import'
  );

  content = replaceOnce(
    content,
    '  DropdownMenuContent,\n  DropdownMenuItem,\n  DropdownMenuTrigger,',
    '  DropdownMenuContent,\n  DropdownMenuItem,\n  DropdownMenuSeparator,\n  DropdownMenuTrigger,',
    'composer dropdown separator import'
  );

  content = replaceOnce(
    content,
    '    // Max 4 lines (~96px)\n    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;',
    '    // Grow naturally, capped at roughly five lines.\n    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;',
    'composer textarea height'
  );

  content = replaceOnce(
    content,
    '  const handleSend = useCallback(async () => {',
    `  const persistTextDraft = useCallback(\n    (value: string) => {\n      try {\n        const key = \`wacrm:composer-draft:\${conversationId}\`;\n        if (value) sessionStorage.setItem(key, value);\n        else sessionStorage.removeItem(key);\n      } catch {\n        // Storage may be unavailable in hardened/private browser contexts.\n      }\n    },\n    [conversationId]\n  );\n\n  useEffect(() => {\n    try {\n      const saved = sessionStorage.getItem(\`wacrm:composer-draft:\${conversationId}\`) ?? '';\n      // eslint-disable-next-line react-hooks/set-state-in-effect\n      setText(saved);\n      requestAnimationFrame(adjustHeight);\n    } catch {\n      // eslint-disable-next-line react-hooks/set-state-in-effect\n      setText('');\n    }\n  }, [conversationId, adjustHeight]);\n\n  useEffect(() => {\n    const handleExternalDraft = (event: Event) => {\n      const detail = (event as CustomEvent<{ conversationId?: string; text?: string }>).detail;\n      if (detail?.conversationId !== conversationId || !detail.text) return;\n      setText(detail.text);\n      persistTextDraft(detail.text);\n      requestAnimationFrame(() => {\n        adjustHeight();\n        const el = textareaRef.current;\n        if (el) {\n          el.focus();\n          el.setSelectionRange(el.value.length, el.value.length);\n        }\n      });\n    };\n\n    window.addEventListener('wacrm:composer-draft', handleExternalDraft);\n    return () => window.removeEventListener('wacrm:composer-draft', handleExternalDraft);\n  }, [adjustHeight, conversationId, persistTextDraft]);\n\n  const handleSend = useCallback(async () => {`,
    'composer persisted draft helpers'
  );

  content = replaceOnce(
    content,
    '      setText("");\n      if (textareaRef.current) {',
    '      setText("");\n      persistTextDraft("");\n      if (textareaRef.current) {',
    'composer clear persisted draft on send'
  );

  content = replaceOnce(
    content,
    '  }, [text, sending, sessionExpired, onSend, replyTo?.id]);',
    '  }, [text, sending, sessionExpired, onSend, replyTo?.id, persistTextDraft]);',
    'composer handleSend deps'
  );

  content = replaceOnce(
    content,
    '      setText(e.target.value);\n      adjustHeight();',
    '      setText(e.target.value);\n      persistTextDraft(e.target.value);\n      adjustHeight();',
    'composer persist on change'
  );

  content = replaceOnce(
    content,
    '    [adjustHeight]\n  );',
    '    [adjustHeight, persistTextDraft]\n  );',
    'composer handleChange deps'
  );

  content = replaceOnce(
    content,
    '      setText(draftText);\n      // Let the textarea grow to fit',
    '      setText(draftText);\n      persistTextDraft(draftText);\n      // Let the textarea grow to fit',
    'composer persist AI draft'
  );

  content = replaceOnce(
    content,
    '  }, [drafting, conversationId, adjustHeight]);',
    '  }, [drafting, conversationId, adjustHeight, persistTextDraft]);',
    'composer AI draft deps'
  );

  content = replaceOnce(
    content,
    '      setText((prev) =>\n        prev && !/\\s$/.test(prev) ? `${prev}\\n${body}` : `${prev}${body}`,\n      );',
    `      setText((prev) => {\n        const next = prev && !/\\s$/.test(prev) ? \`\${prev}\\n\${body}\` : \`\${prev}\${body}\`;\n        persistTextDraft(next);\n        return next;\n      });`,
    'composer quick reply persistence'
  );

  content = replaceOnce(
    content,
    '    [openInteractiveBuilder, adjustHeight],',
    '    [openInteractiveBuilder, adjustHeight, persistTextDraft],',
    'composer quick reply deps'
  );

  content = replaceOnce(
    content,
    '<div className="border-t border-border bg-card p-3">',
    '<div className="border-border bg-card border-t px-3 py-2.5">',
    'composer outer spacing'
  );

  content = replaceOnce(
    content,
    '      ) : (\n        <div className="flex items-end gap-2">',
    '      ) : (\n        <div className="border-border bg-background focus-within:border-primary/40 focus-within:ring-primary/10 flex items-end gap-1.5 rounded-2xl border p-1.5 shadow-sm transition focus-within:ring-2">',
    'composer unified input surface'
  );

  const toolbarStart = '          {/* Attach menu — photo / video / document / voice. */}';
  const textareaMarker = '          <textarea\n            ref={textareaRef}';
  const toolbarReplacement = `          {/* One action menu keeps attachments, templates and rich messages\n              discoverable without four competing icon buttons. */}\n          <DropdownMenu>\n            <DropdownMenuTrigger\n              disabled={readOnly || busy}\n              title={readOnly ? t("readOnlyTitle") : t("moreActions")}\n              className="hover:bg-muted hover:text-foreground inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"\n            >\n              {busy ? (\n                <Loader2 className="size-4 animate-spin" />\n              ) : (\n                <Plus className="size-5" />\n              )}\n            </DropdownMenuTrigger>\n            <DropdownMenuContent align="start" className="w-56">\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => imageInputRef.current?.click()}>\n                <ImageIcon className="size-4" />\n                {t("photo")}\n              </DropdownMenuItem>\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => videoInputRef.current?.click()}>\n                <Video className="size-4" />\n                {t("video")}\n              </DropdownMenuItem>\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => documentInputRef.current?.click()}>\n                <FileText className="size-4" />\n                {t("document")}\n              </DropdownMenuItem>\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => void startRecording()}>\n                <Mic className="size-4" />\n                {t("voiceNote")}\n              </DropdownMenuItem>\n              <DropdownMenuSeparator />\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => openInteractiveBuilder()}>\n                <MessageSquareDashed className="size-4" />\n                {t("interactiveMessage")}\n              </DropdownMenuItem>\n              <DropdownMenuItem disabled={inputsDisabled} onClick={() => setQuickReplyOpen(true)}>\n                <Zap className="size-4" />\n                {t("quickReplies")}\n              </DropdownMenuItem>\n              <DropdownMenuItem onClick={onOpenTemplates}>\n                <LayoutTemplate className="size-4" />\n                {t("templates")}\n              </DropdownMenuItem>\n            </DropdownMenuContent>\n          </DropdownMenu>\n\n          <GatedButton\n            variant="ghost"\n            size="sm"\n            canAct={!readOnly}\n            gateReason="send messages"\n            disabled={drafting || sessionExpired}\n            title={readOnly ? undefined : t("draftWithAI")}\n            className="hover:bg-primary/10 hover:text-primary h-10 shrink-0 gap-1.5 rounded-xl px-2.5 text-muted-foreground"\n            onClick={handleDraft}\n          >\n            {drafting ? (\n              <Loader2 className="size-4 animate-spin" />\n            ) : (\n              <Sparkles className="size-4" />\n            )}\n            <span className="hidden text-xs font-medium sm:inline">IA</span>\n          </GatedButton>\n\n`;

  content = replaceBetween(
    content,
    toolbarStart,
    textareaMarker,
    toolbarReplacement,
    'composer toolbar consolidation'
  );

  content = replaceOnce(
    content,
    ': t("typeMessagePlaceholder")',
    ': t("typeMessagePlaceholder").split(" (")[0]',
    'composer simplified placeholder'
  );

  content = replaceOnce(
    content,
    '              "flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",',
    '              "min-h-10 flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-0",',
    'composer textarea chrome'
  );

  content = replaceOnce(
    content,
    '            className="wa-send-button h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"',
    '            className="wa-send-button bg-primary hover:bg-primary/90 size-10 shrink-0 rounded-xl p-0 disabled:opacity-30"',
    'composer send button'
  );

  const hintStart = '      {/* Hint sits outside the flex row so its height doesn\'t push';
  const interactiveMarker = '      {/* Interactive-message builder dialog. */}';
  content = replaceBetween(
    content,
    hintStart,
    interactiveMarker,
    interactiveMarker,
    'composer remove permanent AI tutorial hint'
  );

  write(path, content);
}

// Lower the wallpaper contrast so the message content, not the decoration,
// is the visual anchor of the thread.
{
  const path = 'public/inbox-doodle.svg';
  let content = read(path);
  content = replaceOnce(
    content,
    'stroke-opacity="0.22"',
    'stroke-opacity="0.10"',
    'doodle contrast'
  );
  content = content.replace('at 22% opacity', 'at 10% opacity');
  write(path, content);
}

console.log('Inbox operating UX patch applied successfully.');

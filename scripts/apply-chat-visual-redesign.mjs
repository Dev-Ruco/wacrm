import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing pattern: ${label}`);
  return content.replace(from, to);
}

// 1) Dedicated chat palette + bubble primitives, independent from the app accent.
{
  const path = 'src/app/globals.css';
  let s = read(path);
  const marker = `/* Authentic circular send button — only under the WhatsApp theme, and\n * only on the composer's actual send action (marked with this class),`;
  const block = `/* ---- Inbox chat visual language ------------------------------------------------\n * The conversation surface has its own palette instead of inheriting the current\n * product accent. This keeps long-form chat readable and visually stable across\n * violet/emerald/cobalt/etc. themes. Values intentionally echo familiar modern\n * messaging ergonomics without copying another product's proprietary artwork.\n */\n:root,\nhtml[data-mode="dark"] {\n  --chat-header: #202c33;\n  --chat-header-foreground: #e9edef;\n  --bubble-out: #005c4b;\n  --bubble-out-foreground: #e9edef;\n  --bubble-in: #202c33;\n  --bubble-in-foreground: #e9edef;\n  --wallpaper-tint: #0b141a;\n  --chat-meta-out: #a7c7bd;\n  --chat-meta-in: #8696a0;\n  --chat-read: #53bdeb;\n  --chat-date-bg: rgb(24 34 41 / 0.9);\n  --chat-date-fg: #8696a0;\n  --chat-in-border: rgb(255 255 255 / 0.035);\n  --chat-ai-badge-bg: rgb(255 255 255 / 0.09);\n  --chat-bubble-shadow: 0 1px 0.5px rgb(0 0 0 / 0.22);\n}\n\nhtml[data-mode="light"] {\n  --chat-header: #f0f2f5;\n  --chat-header-foreground: #111b21;\n  --bubble-out: #d9fdd3;\n  --bubble-out-foreground: #111b21;\n  --bubble-in: #ffffff;\n  --bubble-in-foreground: #111b21;\n  --wallpaper-tint: #efeae2;\n  --chat-meta-out: #667781;\n  --chat-meta-in: #667781;\n  --chat-read: #53bdeb;\n  --chat-date-bg: rgb(255 255 255 / 0.88);\n  --chat-date-fg: #54656f;\n  --chat-in-border: rgb(17 27 33 / 0.045);\n  --chat-ai-badge-bg: rgb(17 27 33 / 0.06);\n  --chat-bubble-shadow: 0 1px 0.5px rgb(11 20 26 / 0.13);\n}\n\n.chat-bubble {\n  isolation: isolate;\n}\n\n.chat-bubble-tail-out::after,\n.chat-bubble-tail-in::after {\n  content: "";\n  position: absolute;\n  top: 0;\n  width: 0;\n  height: 0;\n  pointer-events: none;\n}\n\n.chat-bubble-tail-out::after {\n  right: -6px;\n  border-top: 9px solid var(--bubble-out);\n  border-right: 7px solid transparent;\n}\n\n.chat-bubble-tail-in::after {\n  left: -6px;\n  border-top: 9px solid var(--bubble-in);\n  border-left: 7px solid transparent;\n}\n\n`;
  if (!s.includes('/* ---- Inbox chat visual language')) {
    s = replaceOnce(s, marker, block + marker, 'chat palette marker');
  }
  write(path, s);
}

// 2) Bubble widths and hover tools: narrower desktop line length, generous mobile width.
{
  const path = 'src/components/inbox/message-actions.tsx';
  let s = read(path);
  s = replaceOnce(
    s,
    '<div className="group/actions relative min-w-0 max-w-[75%]">',
    '<div className="group/actions relative min-w-0 max-w-[88%] sm:max-w-[78%] xl:max-w-[68%]">',
    'message max width',
  );
  s = s.replace('respect the 75% cap', 'respect the responsive width cap');
  write(path, s);
}

// 3) Message bubble typography, metadata, tails and neutral chat colors.
{
  const path = 'src/components/inbox/message-bubble.tsx';
  let s = read(path);

  s = replaceOnce(
    s,
    '  onOpenMedia?: (messageId: string) => void;\n}',
    '  onOpenMedia?: (messageId: string) => void;\n  /** Show the small chat tail only at the start of a sender run. */\n  showTail?: boolean;\n}',
    'showTail prop',
  );

  s = replaceOnce(
    s,
    '  onToggleReaction,\n  onOpenMedia,\n}: MessageBubbleProps) {',
    '  onToggleReaction,\n  onOpenMedia,\n  showTail = false,\n}: MessageBubbleProps) {',
    'showTail parameter',
  );

  s = s.replaceAll('whitespace-pre-wrap break-words text-sm', 'whitespace-pre-wrap break-words text-[15px] leading-[1.45]');
  s = s.replaceAll('flex items-center gap-2 text-sm', 'flex items-center gap-2 text-[15px] leading-[1.45]');
  s = s.replace('text-sm italic text-muted-foreground', 'text-[15px] leading-[1.45] italic text-muted-foreground');

  s = replaceOnce(
    s,
    '          "relative rounded-2xl px-3 py-2",\n          isAgent\n            ? "rounded-br-md bg-[var(--bubble-out,var(--primary))] text-[var(--bubble-out-foreground,var(--primary-foreground))]"\n            : "rounded-bl-md bg-[var(--bubble-in,var(--muted))] text-[var(--bubble-in-foreground,var(--foreground))]",',
    '          "chat-bubble relative rounded-[10px] px-2.5 py-1.5 shadow-[var(--chat-bubble-shadow)]",\n          isAgent\n            ? "bg-[var(--bubble-out)] text-[var(--bubble-out-foreground)]"\n            : "border border-[var(--chat-in-border)] bg-[var(--bubble-in)] text-[var(--bubble-in-foreground)]",\n          showTail && (isAgent ? "chat-bubble-tail-out" : "chat-bubble-tail-in"),',
    'bubble surface',
  );

  s = s.replace('"mt-1 flex items-center gap-1"', '"mt-0.5 flex min-h-3.5 items-center gap-1"');

  s = replaceOnce(
    s,
    'className="inline-flex items-center gap-0.5 rounded-full bg-[var(--bubble-out-foreground,var(--primary-foreground))]/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-[var(--bubble-out-foreground,var(--primary-foreground))]"',
    'className="inline-flex items-center gap-0.5 rounded-full bg-[var(--chat-ai-badge-bg)] px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-[var(--chat-meta-out)]"',
    'AI badge',
  );

  s = replaceOnce(
    s,
    '              "text-[10px]",\n              // Outbound bubbles sit on the primary fill, so the\n              // timestamp must read against that (not the neutral\n              // foreground) — otherwise it goes low-contrast in light\n              // mode. Inbound bubbles use the muted surface.\n              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",',
    '              "text-[11px] leading-none tabular-nums",\n              isAgent\n                ? "text-[var(--chat-meta-out)]"\n                : "text-[var(--chat-meta-in)]",',
    'timestamp colors',
  );

  s = s.replace('<Clock className="h-3 w-3 text-muted-foreground" />', '<Clock className="h-3 w-3 text-[var(--chat-meta-out)]" />');
  s = s.replace('<Check className="h-3 w-3 text-muted-foreground" />', '<Check className="h-3 w-3 text-[var(--chat-meta-out)]" />');
  s = s.replaceAll('<CheckCheck className="h-3 w-3 text-muted-foreground" />', '<CheckCheck className="h-3 w-3 text-[var(--chat-meta-out)]" />');
  s = s.replace('<CheckCheck className="h-3 w-3 text-blue-400" />', '<CheckCheck className="h-3 w-3 text-[var(--chat-read)]" />');

  write(path, s);
}

// 4) Thread density, date chips, tail boundaries and wallpaper scale.
{
  const path = 'src/components/inbox/message-thread.tsx';
  let s = read(path);

  s = replaceOnce(
    s,
    'const DOODLE_BG_CLASSES =\n  "bg-[var(--wallpaper-tint,var(--background))] bg-[url(\'/inbox-doodle.svg\')] bg-repeat";',
    'const DOODLE_BG_CLASSES =\n  "bg-[var(--wallpaper-tint,var(--background))] bg-[url(\'/inbox-doodle.svg\')] bg-[length:320px_320px] bg-repeat";',
    'wallpaper classes',
  );

  s = replaceOnce(
    s,
    '<div ref={scrollRef} onScroll={handleThreadScroll} className="flex-1 overflow-y-auto px-4 py-4">',
    '<div ref={scrollRef} onScroll={handleThreadScroll} className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 lg:px-6">',
    'message area padding',
  );

  s = replaceOnce(
    s,
    '<span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">',
    '<span className="rounded-md border border-black/[0.03] bg-[var(--chat-date-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--chat-date-fg)] shadow-sm backdrop-blur-sm">',
    'date separator',
  );

  s = replaceOnce(s, '<div className="space-y-2">\n                  {group.messages.map((msg) => {', '<div className="space-y-0">\n                  {group.messages.map((msg, index) => {', 'message grouping map');

  s = replaceOnce(
    s,
    '                    const parent = msg.reply_to_message_id\n                      ? messagesById.get(msg.reply_to_message_id)\n                      : null;',
    '                    const currentIsAgent =\n                      msg.sender_type === "agent" || msg.sender_type === "bot";\n                    const previous = index > 0 ? group.messages[index - 1] : null;\n                    const previousIsAgent = previous\n                      ? previous.sender_type === "agent" || previous.sender_type === "bot"\n                      : null;\n                    const startsNewRun = index === 0 || currentIsAgent !== previousIsAgent;\n                    const parent = msg.reply_to_message_id\n                      ? messagesById.get(msg.reply_to_message_id)\n                      : null;',
    'sender run calculation',
  );

  s = replaceOnce(
    s,
    '                    return (\n                      <MessageActions\n                        key={msg.id}',
    '                    return (\n                      <div\n                        key={msg.id}\n                        className={cn(index > 0 && (startsNewRun ? "mt-2" : "mt-0.5"))}\n                      >\n                      <MessageActions',
    'message spacing wrapper start',
  );

  s = replaceOnce(
    s,
    '                          onToggleReaction={handlePillToggle}\n                          onOpenMedia={handleMediaChange}\n                        />\n                      </MessageActions>\n                    );',
    '                          onToggleReaction={handlePillToggle}\n                          onOpenMedia={handleMediaChange}\n                          showTail={startsNewRun}\n                        />\n                      </MessageActions>\n                      </div>\n                    );',
    'message spacing wrapper end',
  );

  write(path, s);
}

// 5) Original WACRM conversation wallpaper: dense, small, low-contrast motifs.
{
  const path = 'public/inbox-doodle.svg';
  write(path, `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Original WACRM conversation wallpaper. Generic communication, commerce and\n     productivity motifs; deliberately not a copy of any third-party pattern. -->\n<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" fill="none" stroke="#827a72" stroke-opacity="0.17" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\n  <g transform="translate(18 18) scale(.62)"><path d="M22 17a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></g>\n  <g transform="translate(72 12) scale(.54) rotate(-12 12 12)"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L9 10.6a16 16 0 0 0 4.4 4.4l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></g>\n  <g transform="translate(128 22) scale(.48)"><path d="M12 2l3 6 7 .9-5 4.8 1.2 6.8L12 17.3 5.8 20.5 7 13.7 2 8.9 9 8z"/></g>\n  <g transform="translate(176 13) scale(.5) rotate(8 12 12)"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></g>\n  <g transform="translate(230 18) scale(.55)"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></g>\n  <g transform="translate(282 28) scale(.45)"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></g>\n\n  <g transform="translate(38 66) scale(.48)"><path d="M3 6h18l-2 12H5zM8 6V4a4 4 0 0 1 8 0v2"/></g>\n  <g transform="translate(94 70) scale(.5) rotate(-7 12 12)"><path d="M20 7l-8 8-4-4-6 6M14 7h6v6"/></g>\n  <g transform="translate(150 62) scale(.5)"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>\n  <g transform="translate(204 70) scale(.48)"><path d="M4 5h16v14H4zM4 8l8 6 8-6"/></g>\n  <g transform="translate(258 64) scale(.5) rotate(10 12 12)"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></g>\n\n  <g transform="translate(12 118) scale(.5)"><path d="M4 19h16M6 17V9h4v8M14 17V5h4v12"/></g>\n  <g transform="translate(68 122) scale(.46)"><circle cx="12" cy="12" r="9"/><path d="M12 6v12M16 8.5c-1-1-2.2-1.5-4-1.5-2 0-3 1-3 2.3 0 3.5 7 1.5 7 5 0 1.5-1.2 2.7-3.5 2.7-1.8 0-3.2-.5-4.2-1.6"/></g>\n  <g transform="translate(126 116) scale(.52) rotate(-9 12 12)"><path d="M4 7h16l-1.5 11h-13zM8 7l1-3h6l1 3"/></g>\n  <g transform="translate(180 122) scale(.45)"><path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2zM20 17l1 2.5 2.5 1-2.5 1L20 24l-1-2.5-2.5-1 2.5-1z"/></g>\n  <g transform="translate(238 116) scale(.5)"><path d="M3 4h18v16H3zM7 8h10M7 12h7M7 16h5"/></g>\n  <g transform="translate(290 126) scale(.42)"><path d="M12 2a10 10 0 1 0 10 10M12 6v6l4 2"/></g>\n\n  <g transform="translate(30 174) scale(.48) rotate(8 12 12)"><path d="M4 6h16v12H4zM8 20h8M12 18v2"/></g>\n  <g transform="translate(86 170) scale(.5)"><path d="M3 3h18v18H3zM7 7h10v10H7z"/></g>\n  <g transform="translate(145 174) scale(.46)"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M3 20c0-4 2.5-6 6-6s6 2 6 6M14 20c.3-3 2.2-5 5-5 2 0 3.5.9 4 2.5"/></g>\n  <g transform="translate(202 169) scale(.5) rotate(-8 12 12)"><path d="M4 4h16v16H4zM8 12l3 3 5-6"/></g>\n  <g transform="translate(260 176) scale(.46)"><path d="M2 7h20l-2 10H6L4 3H1M8 21h.01M18 21h.01"/></g>\n\n  <g transform="translate(14 232) scale(.5)"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></g>\n  <g transform="translate(72 226) scale(.48)"><path d="M4 4h16v16H4zM4 9h16M9 4v16"/></g>\n  <g transform="translate(130 234) scale(.45) rotate(9 12 12)"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></g>\n  <g transform="translate(188 226) scale(.5)"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></g>\n  <g transform="translate(246 234) scale(.48)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></g>\n  <g transform="translate(292 222) scale(.43)"><path d="M12 3v18M3 12h18"/></g>\n\n  <g transform="translate(38 284) scale(.42)"><path d="M4 12h16M12 4v16M6 6l12 12M18 6L6 18"/></g>\n  <g transform="translate(104 278) scale(.46)"><path d="M6 3h12l3 6-9 12L3 9zM3 9h18"/></g>\n  <g transform="translate(172 282) scale(.42)"><path d="M4 4h16v16H4zM8 8h8v8H8z"/></g>\n  <g transform="translate(236 278) scale(.46)"><path d="M12 2l4 7 7 3-7 3-4 7-4-7-7-3 7-3z"/></g>\n  <g transform="translate(292 286) scale(.4)"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></g>\n</svg>\n`);
}

console.log('chat visual redesign applied');

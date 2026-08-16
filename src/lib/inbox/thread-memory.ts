import type { Message } from '@/types'

export interface ThreadViewport {
  scrollTop: number
  atBottom: boolean
}

export interface CachedThread {
  messages: Message[]
  viewport: ThreadViewport | null
}

const MAX_CACHED_THREADS = 24
const threadMemory = new Map<string, CachedThread>()

function writeThread(conversationId: string, thread: CachedThread): void {
  if (!conversationId) return

  // Reinsert on writes so the map behaves as a small LRU without mutating it
  // during React renders. Twenty-four complete threads is enough for quick
  // operator back-and-forth while keeping memory bounded on long shifts.
  threadMemory.delete(conversationId)
  threadMemory.set(conversationId, thread)

  while (threadMemory.size > MAX_CACHED_THREADS) {
    const oldest = threadMemory.keys().next().value as string | undefined
    if (!oldest) break
    threadMemory.delete(oldest)
  }
}

/**
 * Read-only render-safe lookup. This cache is intentionally memory-only:
 * customer messages are never copied to localStorage/sessionStorage, and a
 * hard browser reload still starts from Supabase as the source of truth.
 */
export function getCachedThread(conversationId: string): CachedThread | null {
  return threadMemory.get(conversationId) ?? null
}

/** Store the latest known authoritative/optimistic thread snapshot. */
export function cacheThreadMessages(
  conversationId: string,
  messages: Message[],
): void {
  const current = threadMemory.get(conversationId)
  writeThread(conversationId, {
    messages,
    viewport: current?.viewport ?? null,
  })
}

/** Store the operator's reading position independently from message updates. */
export function cacheThreadViewport(
  conversationId: string,
  viewport: ThreadViewport,
): void {
  const current = threadMemory.get(conversationId)
  writeThread(conversationId, {
    messages: current?.messages ?? [],
    viewport,
  })
}

/** Test-only reset; not used by the Inbox runtime. */
export function resetThreadMemoryForTests(): void {
  threadMemory.clear()
}

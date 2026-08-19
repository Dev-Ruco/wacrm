"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Count of unread notifications for the current user, explicitly scoped
 * to the current account at both query and Realtime subscription level.
 */
export function useUnreadNotifications(): number {
  const { accountId, user } = useAuth();
  const userId = user?.id ?? null;
  const [count, setCount] = useState(0);

  const loadCount = useCallback(async () => {
    if (!accountId || !userId) return;

    const supabase = createClient();
    const { count: unreadCount, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) {
      console.error("Failed to count unread notifications:", error);
      return;
    }
    setCount(unreadCount ?? 0);
  }, [accountId, userId]);

  useEffect(() => {
    if (!accountId || !userId) return;

    const supabase = createClient();
    let cancelled = false;

    void loadCount();

    const channelId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`notifications-unread-count:${accountId}:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "wacrm",
          table: "notifications",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (cancelled) return;

          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const row = payload.new as { user_id?: string };
            if (row.user_id && row.user_id !== userId) return;
          }

          // Recount instead of trying to infer DELETE transitions from
          // payload.old, which may contain only the primary key unless the
          // table uses REPLICA IDENTITY FULL.
          void loadCount();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId, loadCount, userId]);

  return accountId && userId ? count : 0;
}

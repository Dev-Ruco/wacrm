"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const { accountId } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null);

  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled || !accountId) return;

    const supabase = createClient();
    const accountFilter = `account_id=eq.${accountId}`;
    let disposed = false;

    const channel = supabase
      .channel(`${channelName}:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "wacrm",
          table: "messages",
          filter: accountFilter,
        },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "wacrm",
          table: "conversations",
          filter: accountFilter,
        },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        },
      )
      .subscribe((status) => {
        if (disposed) return;
        setConnectedAccountId(status === "SUBSCRIBED" ? accountId : null);
      });

    channelRef.current = channel;

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [accountId, channelName, enabled]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setConnectedAccountId(null);
    }
  }, []);

  const isConnected = Boolean(
    enabled && accountId && connectedAccountId === accountId,
  );

  return { isConnected, unsubscribe };
}

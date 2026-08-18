'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Notification } from '@/types';
import { Bell, CheckCheck, Loader2, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('notifications-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'wacrm', table: 'notifications' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((notification) => notification.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((notification) =>
                  notification.id === row.id ? { ...notification, ...row } : notification
                ) ?? prev
            );
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((notification) => notification.id !== oldRow.id) ?? prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications(
        (prev) =>
          prev?.map((notification) =>
            notification.id === id && !notification.read_at
              ? { ...notification, read_at: new Date().toISOString() }
              : notification
          ) ?? prev
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (updateErr) {
        toast.error('Não foi possível marcar a notificação como lida.');
        load();
      }
    },
    [load]
  );

  const handleClick = useCallback(
    (notification: Notification) => {
      if (!notification.read_at) markRead(notification.id);
      if (notification.conversation_id) {
        router.push(`/inbox?c=${notification.conversation_id}`);
      }
    },
    [markRead, router]
  );

  const unreadIds = useMemo(
    () => notifications?.filter((notification) => !notification.read_at).map((notification) => notification.id) ?? [],
    [notifications]
  );

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((notification) => (notification.read_at ? notification : { ...notification, read_at: now })) ?? prev
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .is('read_at', null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error('Não foi possível marcar todas como lidas.');
      load();
    }
  }, [unreadIds.length, load]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="wacrm-page-header">
        <div>
          <p className="text-label text-primary">Sistema</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">
            Notificações
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Atribuições de conversas e alertas importantes da equipa aparecem aqui.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadIds.length === 0 || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCheck className="size-4" />
          )}
          Marcar todas como lidas
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <NotificationMetric label="Total" value={notifications.length} />
        <NotificationMetric label="Não lidas" value={unreadIds.length} emphasize />
        <NotificationMetric label="Lidas" value={notifications.length - unreadIds.length} />
      </section>

      {notifications.length === 0 ? (
        <div className="wacrm-surface flex min-h-56 flex-col items-center justify-center border-dashed px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Bell className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-foreground">Sem notificações</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Os alertas importantes e as conversas que lhe forem atribuídas aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="wacrm-surface overflow-hidden">
          <ul className="divide-y divide-border">
            {notifications.map((notification) => {
              const Icon = TYPE_ICON[notification.type] ?? Bell;
              const isUnread = !notification.read_at;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors sm:px-5',
                      isUnread ? 'bg-primary/[0.045] hover:bg-primary/[0.075]' : 'hover:bg-muted/45'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-xl',
                        isUnread ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'
                      )}
                      aria-hidden
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm font-semibold',
                            isUnread ? 'text-foreground' : 'text-foreground/75'
                          )}
                        >
                          {notification.title}
                        </span>
                        {isUnread ? (
                          <span aria-label="Não lida" className="size-2 shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      {notification.body ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {notification.body}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[11px] text-muted-foreground/75">
                        {formatDistanceToNow(new Date(notification.created_at), {
                          addSuffix: true,
                          locale: pt,
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationMetric({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="wacrm-surface px-4 py-3.5">
      <p className="text-meta">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {emphasize ? <span className="size-2 rounded-full bg-primary" /> : null}
        <p className="text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Trash2, UserRoundX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type DeleteScope = 'conversation' | 'conversation_and_contact';

interface ConversationDeleteActionProps {
  contactId: string;
  phone?: string | null;
  displayName?: string | null;
}

const DELETE_OPTIONS: Array<{
  value: DeleteScope;
  title: string;
  description: string;
  icon: typeof MessageSquare;
  danger?: boolean;
}> = [
  {
    value: 'conversation',
    title: 'Apagar apenas o chat',
    description:
      'Remove as mensagens e o histórico deste chat. O contacto e o número continuam guardados no CRM.',
    icon: MessageSquare,
  },
  {
    value: 'conversation_and_contact',
    title: 'Apagar chat e contacto',
    description:
      'Remove também o contacto/número do CRM. Notas, etiquetas e outros dados que pertencem ao contacto seguem as regras actuais de eliminação.',
    icon: UserRoundX,
    danger: true,
  },
];

export function ConversationDeleteAction({
  contactId,
  phone,
  displayName,
}: ConversationDeleteActionProps) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<DeleteScope>('conversation');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setOpen(false);
    setScope('conversation');
    setDeleting(false);
  }, [contactId]);

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);

    try {
      const response = await fetch(`/api/inbox/contact/${contactId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(payload?.error ?? 'Não foi possível apagar a conversa.');
        return;
      }

      toast.success(
        scope === 'conversation'
          ? 'Chat apagado. O contacto continua guardado.'
          : 'Chat e contacto apagados.',
      );

      // A deleted chat must disappear from the list and from the selected
      // workspace immediately. A full navigation also clears any cached
      // realtime rows/drafts tied to the deleted IDs.
      window.location.assign('/inbox');
    } catch {
      toast.error('Não foi possível apagar a conversa.');
    } finally {
      setDeleting(false);
    }
  };

  const targetLabel = displayName || phone || 'este contacto';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-destructive/5 hover:text-destructive flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors"
      >
        <Trash2 className="size-3.5 shrink-0" />
        <span>Apagar conversa</span>
      </button>

      <Dialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apagar conversa?</DialogTitle>
            <DialogDescription>
              Escolha o que pretende remover para {targetLabel}.
              {phone ? ` Número: ${phone}.` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1" role="radiogroup" aria-label="O que apagar">
            {DELETE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = scope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={deleting}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                    selected
                      ? option.danger
                        ? 'border-destructive/50 bg-destructive/5'
                        : 'border-primary/45 bg-primary/[0.04]'
                      : 'border-border hover:bg-muted/50',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                      option.danger
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          option.danger ? 'text-destructive' : 'text-foreground',
                        )}
                      >
                        {option.title}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'ml-auto mt-0.5 size-3.5 shrink-0 rounded-full border-2',
                          selected
                            ? option.danger
                              ? 'border-destructive bg-destructive shadow-[inset_0_0_0_3px_var(--background)]'
                              : 'border-primary bg-primary shadow-[inset_0_0_0_3px_var(--background)]'
                            : 'border-muted-foreground/35',
                        )}
                      />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {scope === 'conversation_and_contact' ? (
            <p className="text-destructive bg-destructive/5 rounded-lg px-3 py-2 text-xs leading-relaxed">
              Esta opção é permanente e pode remover outros chats existentes para o mesmo número.
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {scope === 'conversation' ? 'Apagar chat' : 'Apagar chat e contacto'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

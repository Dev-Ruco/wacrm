'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, ContactNote, Deal, Tag } from '@/types';
import {
  Check,
  Copy,
  DollarSign,
  Mail,
  Phone,
  Plus,
  StickyNote,
  Tag as TagIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { ConversationDeleteAction } from './conversation-delete-action';

interface ContactSidebarProps {
  contact: Contact | null;
  channel?: string | null;
}

function contactSubtitle(contact: Contact, channel?: string | null) {
  const company = contact.company?.trim();
  const genericLegacyCompany = !company || company === 'Cliente WhatsApp';
  if (genericLegacyCompany) {
    if (channel === 'website') return 'Cliente do Site';
    if (channel === 'instagram') return 'Cliente Instagram';
    if (channel === 'facebook') return 'Cliente Facebook';
    if (channel === 'tiktok') return 'Cliente TikTok';
    if (channel === 'whatsapp') return 'Cliente WhatsApp';

    // Website sessions created before the pre-chat lead form used a private
    // synthetic phone in the 900 + 12 digits namespace. Do not present those
    // historical contacts as WhatsApp customers merely because an old generic
    // company label is still stored on the contact.
    const digits = contact.phone.replace(/\D/g, '');
    if (/^900\d{12}$/.test(digits)) return 'Cliente do Site';
  }
  return company || 'Cliente';
}

export function ContactSidebar({ contact, channel }: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  const { accountId } = useAuth();

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-64 items-center justify-center border-l px-5 xl:w-72">
        <p className="text-muted-foreground text-center text-xs">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <aside className="border-border bg-card flex h-full w-64 flex-col border-l xl:w-72">
      <div className="border-border/80 border-b px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
            {contact.avatar_url ? (
              <img
                src={contact.avatar_url}
                alt={displayName}
                className="size-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            <p className="text-muted-foreground truncate text-xs">
              {contactSubtitle(contact, channel)}
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-0.5">
          <button
            onClick={handleCopyPhone}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors"
          >
            <Phone className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {contact.phone}
            </span>
            {copied ? (
              <Check className="text-primary size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          {contact.email ? (
            <div className="text-muted-foreground flex items-center gap-2 px-1.5 py-1.5 text-xs">
              <Mail className="size-3.5 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          ) : null}
        </div>

        <div className="border-border/70 mt-2 border-t pt-2">
          <ConversationDeleteAction
            contactId={contact.id}
            phone={contact.phone}
            displayName={displayName}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-border/80 divide-y">
          <section className="px-4 py-4">
            <SectionLabel icon={TagIcon}>{tSidebar('tags')}</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </section>

          <section className="px-4 py-4">
            <SectionLabel icon={DollarSign}>{tSidebar('deals')}</SectionLabel>
            <div className="mt-2.5 divide-y divide-border/70">
              {deals.length === 0 ? (
                <p className="text-muted-foreground py-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {deal.title}
                      </p>
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        {deal.currency ?? '$'}
                        {deal.value.toLocaleString()}
                      </span>
                    </div>
                    {deal.stage ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: deal.stage.color }}
                        />
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: deal.stage.color }}
                        >
                          {deal.stage.name}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="px-4 py-4">
            <SectionLabel icon={StickyNote}>{tSidebar('notes')}</SectionLabel>
            <div className="mt-2.5 flex gap-2">
              <textarea
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                placeholder={tSidebar('addNotePlaceholder')}
                rows={2}
                className="border-border bg-background placeholder:text-muted-foreground focus:border-primary/50 min-w-0 flex-1 resize-none rounded-lg border px-2.5 py-2 text-xs text-foreground outline-none"
              />
              <Button
                size="icon-sm"
                variant="outline"
                className="self-stretch"
                onClick={handleAddNote}
                disabled={!newNote.trim() || addingNote}
                aria-label="Adicionar nota"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            {notes.length > 0 ? (
              <div className="mt-3 divide-y divide-border/70">
                {notes.map((note) => (
                  <div key={note.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof TagIcon;
  children: ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
      <Icon className="size-3.5" />
      <span>{children}</span>
    </div>
  );
}

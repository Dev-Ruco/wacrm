import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/ai/admin-client";

type DeleteScope = "conversation" | "conversation_and_contact";

function isDeleteScope(value: unknown): value is DeleteScope {
  return value === "conversation" || value === "conversation_and_contact";
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { contactId } = await params;
    const payload = await request.json().catch(() => ({}));
    const scope = payload?.scope;

    if (!isDeleteScope(scope)) {
      return NextResponse.json(
        { error: "Invalid delete scope" },
        { status: 400 },
      );
    }

    // Resolve the contact with the caller-scoped client first. A contact UUID
    // from another tenant must be indistinguishable from a missing contact.
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("account_id", accountId)
      .maybeSingle();

    if (contactError) throw contactError;
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const db = supabaseAdmin();
    const { data: conversations, error: conversationsError } = await db
      .from("conversations")
      .select("id")
      .eq("account_id", accountId)
      .eq("contact_id", contact.id);
    if (conversationsError) throw conversationsError;

    const conversationIds = (conversations ?? []).map((row) => row.id);

    // Notifications are transient operational records, not business history.
    // Delete them BEFORE touching the contact/conversations. Some older rows
    // can carry a stale notification.account_id while still referencing a
    // conversation/contact from this account. The notifications integrity
    // trigger correctly rejects the FK's ON DELETE SET NULL update in that
    // state ("Notification conversation belongs to another account").
    //
    // The contact above was already tenant-validated with the caller-scoped
    // client. We therefore clean every notification that references exactly
    // this validated contact or one of its validated conversations, including
    // historically inconsistent rows whose own account_id is stale.
    if (conversationIds.length > 0) {
      const { error: conversationNotificationError } = await db
        .from("notifications")
        .delete()
        .in("conversation_id", conversationIds);
      if (conversationNotificationError) throw conversationNotificationError;
    }

    const { error: contactNotificationError } = await db
      .from("notifications")
      .delete()
      .eq("contact_id", contact.id);
    if (contactNotificationError) throw contactNotificationError;

    // deals.conversation_id is an optional legacy pointer. Detach it first so
    // deleting a chat never deletes a deal and cannot be blocked by the FK.
    if (conversationIds.length > 0) {
      const { error: dealError } = await db
        .from("deals")
        .update({ conversation_id: null })
        .eq("account_id", accountId)
        .in("conversation_id", conversationIds);
      if (dealError) throw dealError;
    }

    if (scope === "conversation") {
      if (conversationIds.length > 0) {
        const { error: deleteError } = await db
          .from("conversations")
          .delete()
          .eq("account_id", accountId)
          .eq("contact_id", contact.id);
        if (deleteError) throw deleteError;
      }

      return NextResponse.json({
        success: true,
        scope,
        contact_deleted: false,
        conversations_deleted: conversationIds.length,
      });
    }

    // Existing FK policy intentionally preserves deals/broadcast history by
    // nulling contact_id, while contact-owned notes/tags and conversations
    // follow their existing cascade semantics.
    const { error: contactDeleteError } = await db
      .from("contacts")
      .delete()
      .eq("account_id", accountId)
      .eq("id", contact.id);
    if (contactDeleteError) throw contactDeleteError;

    return NextResponse.json({
      success: true,
      scope,
      contact_deleted: true,
      conversations_deleted: conversationIds.length,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/ai/admin-client";

type DeleteScope = "conversation" | "conversation_and_contact";

function isDeleteScope(value: unknown): value is DeleteScope {
  return value === "conversation" || value === "conversation_and_contact";
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { conversationId } = await params;

    const payload = await request.json().catch(() => ({}));
    const scope = payload?.scope;

    if (!isDeleteScope(scope)) {
      return NextResponse.json(
        { error: "Invalid delete scope" },
        { status: 400 },
      );
    }

    // Resolve through the caller-scoped client first. This is the IDOR guard:
    // a valid UUID from another tenant must behave exactly like a missing row.
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("id", conversationId)
      .eq("account_id", accountId)
      .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const db = supabaseAdmin();

    if (scope === "conversation") {
      // deals.conversation_id predates the later SET NULL safety migration on
      // deals.contact_id, so detach the optional conversation pointer first.
      // The deal itself remains intact.
      const { error: dealError } = await db
        .from("deals")
        .update({ conversation_id: null })
        .eq("account_id", accountId)
        .eq("conversation_id", conversation.id);
      if (dealError) throw dealError;

      const { error: deleteError } = await db
        .from("conversations")
        .delete()
        .eq("account_id", accountId)
        .eq("id", conversation.id);
      if (deleteError) throw deleteError;

      return NextResponse.json({
        success: true,
        scope,
        contact_deleted: false,
      });
    }

    // Deleting the CRM contact intentionally removes every conversation tied
    // to that number through the existing conversations.contact_id CASCADE.
    // Detach optional deal conversation pointers first so that cascade cannot
    // be blocked by the legacy deals.conversation_id FK.
    const { data: contactConversations, error: contactConversationsError } =
      await db
        .from("conversations")
        .select("id")
        .eq("account_id", accountId)
        .eq("contact_id", conversation.contact_id);
    if (contactConversationsError) throw contactConversationsError;

    const conversationIds = (contactConversations ?? []).map((row) => row.id);
    if (conversationIds.length > 0) {
      const { error: dealError } = await db
        .from("deals")
        .update({ conversation_id: null })
        .eq("account_id", accountId)
        .in("conversation_id", conversationIds);
      if (dealError) throw dealError;
    }

    const { error: contactDeleteError } = await db
      .from("contacts")
      .delete()
      .eq("account_id", accountId)
      .eq("id", conversation.contact_id);
    if (contactDeleteError) throw contactDeleteError;

    return NextResponse.json({
      success: true,
      scope,
      contact_deleted: true,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

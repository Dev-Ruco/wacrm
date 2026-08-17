from pathlib import Path

path = Path('src/app/api/site-chat/route.ts')
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    """type WebsiteLead = {\n  name: string\n  phone: string\n  phoneNormalized: string\n}\n""",
    """type WebsiteLead = {\n  name: string\n  phone: string\n  phoneNormalized: string\n}\n\ntype WebsiteProductInquiry = {\n  eventId: string\n  productId: string | null\n  name: string\n  priceMt: number | null\n  imageUrl: string | null\n}\n""",
    'product inquiry type',
)

replace_once(
    """function safeContext(input: unknown): Record<string, unknown> {\n""",
    """function safeHttpsUrl(input: unknown): string | null {\n  if (typeof input !== 'string') return null\n  const value = input.trim().slice(0, 2000)\n  if (!value) return null\n  try {\n    const parsed = new URL(value)\n    return parsed.protocol === 'https:' ? parsed.toString() : null\n  } catch {\n    return null\n  }\n}\n\nfunction parseProductInquiry(input: unknown): WebsiteProductInquiry | null {\n  if (!input || typeof input !== 'object' || Array.isArray(input)) return null\n  const source = input as Record<string, unknown>\n  const eventId = typeof source.event_id === 'string' ? source.event_id.trim().slice(0, 128) : ''\n  const name = typeof source.name === 'string' ? source.name.trim().replace(/\\s+/g, ' ').slice(0, 200) : ''\n  if (!eventId || !/^[A-Za-z0-9_-]+$/.test(eventId) || !name) return null\n\n  const productId = typeof source.product_id === 'string' && source.product_id.trim()\n    ? source.product_id.trim().slice(0, 128)\n    : null\n  const priceMt = typeof source.price_mt === 'number' && Number.isFinite(source.price_mt) && source.price_mt >= 0\n    ? source.price_mt\n    : null\n\n  return {\n    eventId,\n    productId,\n    name,\n    priceMt,\n    imageUrl: safeHttpsUrl(source.image_url),\n  }\n}\n\nfunction productInquiryText(inquiry: WebsiteProductInquiry): string {\n  const price = inquiry.priceMt !== null\n    ? ` · ${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(inquiry.priceMt)} MT`\n    : ''\n  return `Tenho interesse neste produto: ${inquiry.name}${price}`\n}\n\nfunction safeContext(input: unknown): Record<string, unknown> {\n""",
    'product inquiry parser',
)

replace_once(
    """    const message = typeof body?.message === 'string' ? body.message.trim() : ''\n    const context = safeContext(body?.context)\n""",
    """    const message = typeof body?.message === 'string' ? body.message.trim() : ''\n    const productInquiryWasSupplied = body?.product_inquiry !== undefined\n    const productInquiry = parseProductInquiry(body?.product_inquiry)\n    const context = safeContext(body?.context)\n""",
    'parse product inquiry in post',
)

replace_once(
    """    if (message.length > MAX_MESSAGE_LENGTH) {\n      return json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` }, 400, origin)\n    }\n""",
    """    if (message.length > MAX_MESSAGE_LENGTH) {\n      return json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` }, 400, origin)\n    }\n    if (productInquiryWasSupplied && !productInquiry) {\n      return json({ error: 'Invalid product inquiry' }, 400, origin)\n    }\n""",
    'validate product inquiry',
)

replace_once(
    """    if (message) {\n      const now = new Date().toISOString()\n""",
    """    if (productInquiry) {\n      const now = new Date().toISOString()\n      const externalMessageId = `web_product_${productInquiry.eventId}`\n      const { data: existingInquiry, error: existingInquiryError } = await admin\n        .from('messages')\n        .select('id')\n        .eq('conversation_id', conversationId)\n        .eq('message_id', externalMessageId)\n        .maybeSingle()\n      if (existingInquiryError) throw existingInquiryError\n\n      if (!existingInquiry?.id) {\n        const contentText = productInquiryText(productInquiry)\n        const contentType = productInquiry.imageUrl ? 'image' : 'text'\n        const [{ data: current, error: currentError }, { count: priorCustomerMessageCount }] =\n          await Promise.all([\n            admin\n              .from('conversations')\n              .select('unread_count, contact_id, user_id')\n              .eq('id', conversationId)\n              .eq('account_id', channel.account_id)\n              .eq('channel', 'website')\n              .single(),\n            admin\n              .from('messages')\n              .select('id', { count: 'exact', head: true })\n              .eq('conversation_id', conversationId)\n              .eq('sender_type', 'customer'),\n          ])\n        if (currentError || !current?.contact_id || !current?.user_id) {\n          throw currentError ?? new Error('Website conversation routing context is unavailable')\n        }\n\n        const { error: productMessageError } = await admin.from('messages').insert({\n          conversation_id: conversationId,\n          sender_type: 'customer',\n          content_type: contentType,\n          content_text: contentText,\n          media_url: productInquiry.imageUrl,\n          message_id: externalMessageId,\n          status: 'delivered',\n          created_at: now,\n        })\n        if (productMessageError) throw productMessageError\n\n        const { error: conversationError } = await admin\n          .from('conversations')\n          .update({\n            last_message_text: contentText,\n            last_message_at: now,\n            unread_count: Number(current.unread_count ?? 0) + 1,\n            status: 'open',\n            source_metadata: {\n              ...context,\n              product_id: productInquiry.productId ?? context.product_id,\n              product_name: productInquiry.name,\n              product_price_mt: productInquiry.priceMt ?? context.product_price_mt,\n              product_image: productInquiry.imageUrl ?? context.product_image,\n            },\n            updated_at: now,\n          })\n          .eq('id', conversationId)\n        if (conversationError) throw conversationError\n\n        after(async () => {\n          await dispatchInboundThroughAccountBrain({\n            accountId: channel.account_id,\n            conversationId,\n            contactId: current.contact_id as string,\n            configOwnerUserId: current.user_id as string,\n            inboundMessageId: externalMessageId,\n            channel: 'website',\n            text: contentText,\n            contentType,\n            isFirstInboundMessage: (priorCustomerMessageCount ?? 0) === 0,\n          })\n        })\n      }\n    }\n\n    if (message) {\n      const now = new Date().toISOString()\n""",
    'persist product inquiry before text',
)

path.write_text(text)

from pathlib import Path

path = Path('src/app/api/site-chat/route.ts')
text = path.read_text()

old = """    if (message) {\n      const now = new Date().toISOString()\n      const externalMessageId = `web_${randomUUID()}`\n      const [{ data: current, error: currentError }, { count: priorCustomerMessageCount }] =\n"""
new = """    if (message) {\n      const now = new Date().toISOString()\n      const externalMessageId = `web_${randomUUID()}`\n      const contextProductName = typeof context.product_name === 'string' ? context.product_name.trim() : ''\n      const contextProductImage = safeHttpsUrl(context.product_image)\n      const isLegacyProductInterest =\n        !productInquiry &&\n        context.source === 'product_detail' &&\n        Boolean(contextProductName) &&\n        Boolean(contextProductImage) &&\n        message.toLocaleLowerCase('pt-PT').includes(contextProductName.toLocaleLowerCase('pt-PT'))\n      const messageContentType = isLegacyProductInterest ? 'image' : 'text'\n      const messageMediaUrl = isLegacyProductInterest ? contextProductImage : null\n      const [{ data: current, error: currentError }, { count: priorCustomerMessageCount }] =\n"""
if old not in text:
    raise SystemExit('message block start not found')
text = text.replace(old, new, 1)

old = """      const { error: messageError } = await admin.from('messages').insert({\n        conversation_id: conversationId,\n        sender_type: 'customer',\n        content_type: 'text',\n        content_text: message,\n        message_id: externalMessageId,\n        status: 'delivered',\n        created_at: now,\n      })\n"""
new = """      const { error: messageError } = await admin.from('messages').insert({\n        conversation_id: conversationId,\n        sender_type: 'customer',\n        content_type: messageContentType,\n        content_text: message,\n        media_url: messageMediaUrl,\n        message_id: externalMessageId,\n        status: 'delivered',\n        created_at: now,\n      })\n"""
if old not in text:
    raise SystemExit('message insert block not found')
text = text.replace(old, new, 1)

old = """          channel: 'website',\n          text: message,\n          contentType: 'text',\n          isFirstInboundMessage: (priorCustomerMessageCount ?? 0) === 0,\n"""
new = """          channel: 'website',\n          text: message,\n          contentType: messageContentType,\n          isFirstInboundMessage: (priorCustomerMessageCount ?? 0) === 0,\n"""
if old not in text:
    raise SystemExit('brain dispatch block not found')
text = text.replace(old, new, 1)

path.write_text(text)

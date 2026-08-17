from pathlib import Path

path = Path('src/app/api/site-chat/route.ts')
text = path.read_text()
old = """      const contextProductName = typeof context.product_name === 'string' ? context.product_name.trim() : ''\n      const contextProductImage = safeHttpsUrl(context.product_image)\n      const isLegacyProductInterest =\n        !productInquiry &&\n        context.source === 'product_detail' &&\n        Boolean(contextProductName) &&\n        Boolean(contextProductImage) &&\n        message.toLocaleLowerCase('pt-PT').includes(contextProductName.toLocaleLowerCase('pt-PT'))\n"""
new = """      const contextProductImage = safeHttpsUrl(context.product_image)\n      const isLegacyProductInterest =\n        !productInquiry &&\n        context.source === 'product_detail' &&\n        Boolean(contextProductImage) &&\n        /\\btenho\\s+interesse\\b/i.test(message)\n"""
if old not in text:
    raise SystemExit('legacy trigger block not found')
path.write_text(text.replace(old, new, 1))

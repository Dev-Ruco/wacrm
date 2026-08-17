from pathlib import Path

path = Path('src/app/api/site-chat/route.ts')
text = path.read_text()
old = """            status: 'open',\n            source_metadata: {\n              ...context,\n              product_id: productInquiry.productId ?? context.product_id,\n              product_name: productInquiry.name,\n              product_price_mt: productInquiry.priceMt ?? context.product_price_mt,\n              product_image: productInquiry.imageUrl ?? context.product_image,\n            },\n            updated_at: now,\n"""
new = """            status: 'open',\n            updated_at: now,\n"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'preserve source metadata: expected exactly 1 match, found {count}')
path.write_text(text.replace(old, new, 1))

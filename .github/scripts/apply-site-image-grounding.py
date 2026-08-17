from pathlib import Path

path = Path('src/lib/ai/auto-reply.ts')
text = path.read_text()

old = """import {\n  conversationCatalogStatePrompt,\n  loadConversationCatalogState,\n} from './catalog-state'\n"""
new = old + """import { loadSiteProductContext, siteProductContextPrompt } from './site-product-context'\n"""
if old not in text:
    raise SystemExit('catalog-state import not found')
text = text.replace(old, new, 1)

old = """    const [prefetch, crmContext, memories, lessons, catalogueState] = await Promise.all([\n      effectivePermissions.search_catalog\n        ? prefetchCatalogueForConversation({\n"""
new = """    const siteProductContext = await loadSiteProductContext(db, accountId, conversationId).catch((error) => {\n      console.error('[ai auto-reply] site product context lookup failed:', error)\n      return null\n    })\n\n    const [prefetch, crmContext, memories, lessons, catalogueState] = await Promise.all([\n      effectivePermissions.search_catalog && !siteProductContext\n        ? prefetchCatalogueForConversation({\n"""
if old not in text:
    raise SystemExit('prefetch block start not found')
text = text.replace(old, new, 1)

old = """      effectivePermissions.search_catalog\n        ? loadConversationCatalogState({ db, accountId, conversationId }).catch((error) => {\n"""
new = """      effectivePermissions.search_catalog && !siteProductContext\n        ? loadConversationCatalogState({ db, accountId, conversationId }).catch((error) => {\n"""
if old not in text:
    raise SystemExit('catalogue state condition not found')
text = text.replace(old, new, 1)

old = """    const catalogueGrounding = prefetch\n      ? cataloguePrefetchPrompt(prefetch)\n      : null\n    const catalogueStateContext = catalogueState\n"""
new = """    const siteProductGrounding = siteProductContext\n      ? siteProductContextPrompt(siteProductContext)\n      : null\n    const catalogueGrounding = prefetch\n      ? cataloguePrefetchPrompt(prefetch)\n      : null\n    const catalogueStateContext = catalogueState\n"""
if old not in text:
    raise SystemExit('catalogue grounding block not found')
text = text.replace(old, new, 1)

old = """      lessonsContext,\n      catalogueStateContext,\n      catalogueGrounding,\n"""
new = """      lessonsContext,\n      siteProductGrounding,\n      catalogueStateContext,\n      catalogueGrounding,\n"""
if old not in text:
    raise SystemExit('system prompt parts not found')
text = text.replace(old, new, 1)

old = """    const catalogueVerified = agentTools.wasCatalogueVerified()\n"""
new = """    const catalogueVerified =\n      agentTools.wasCatalogueVerified() || Boolean(siteProductContext?.canonical)\n"""
if old not in text:
    raise SystemExit('catalogueVerified line not found')
text = text.replace(old, new, 1)

old = """      trustedPriceAmounts: agentTools.getTrustedPriceAmounts(),\n"""
new = """      trustedPriceAmounts: [\n        ...agentTools.getTrustedPriceAmounts(),\n        ...(siteProductContext?.canonical ? [siteProductContext.canonical.price] : []),\n      ],\n"""
if old not in text:
    raise SystemExit('trustedPriceAmounts line not found')
text = text.replace(old, new, 1)

path.write_text(text)

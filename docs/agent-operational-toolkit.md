# Agent operational toolkit

The autonomous agent now has a layered runtime:

1. mature core tools (catalogue, knowledge, CRM, handoff),
2. operational tools (availability, orders, contact updates),
3. visual catalogue augmentation.

## Operational tools

- `check_availability` — read-only, enabled by default; checks configured recurring windows and exceptions.
- `create_order` — mutation, opt-in; creates a trackable order using current catalogue prices and never confirms payment.
- `get_order_status` — read-only, enabled by default; reads factual order state for the current contact.
- `update_contact` — mutation, opt-in; stores only explicit customer-provided contact/custom-field data.

## Standard skills

Every current and future agent receives routing skills for discovery, product consulting, closing, scheduling, post-sale/order support, and complaints. Skills never grant a disabled tool; they can only narrow account-level permissions.

## Safety boundaries

- Payment is never marked as confirmed by the AI toolkit.
- Order prices are loaded from `catalog_products`, not from model arguments.
- Availability comes from configured windows/exceptions.
- Mutating operational tools are disabled by default until an administrator enables them.
- Preview/draft surfaces cannot execute operational mutations.

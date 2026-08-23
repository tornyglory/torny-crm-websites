# Website Page Builder — Whitelist New Editorial Block Types

**Feature:** small extension to briefs 16/17. The CRM now offers 9 additional block types on the page-builder palette (editorial blocks from the Paper design system). The backend still validates `type` against the original 8, so every autosave rejects with `400 unknown_block_type` the moment a user drops one of the new blocks on a page.

**Status:** requested — frontend is shipped in the CRM, blocked by backend validation.

---

## TL;DR

Extend the block-type whitelist on `PATCH /clubs/:clubId/pages/:pageSlug` (and any other spot that validates block shapes) to accept these 9 additional types on top of the existing 8:

- `mediaSplit`
- `sectionTitle`
- `pullQuote`
- `featureGrid`
- `faqAccordion`
- `fullBleedImage`
- `timeline`
- `twoColumn`
- `divider`

`props` remains opaque JSON — no schema on the backend side. Everything else about the endpoint is unchanged.

---

## What broke

Frontend adds one of the new blocks → autosave fires → backend responds `400 { code: 'unknown_block_type', type: 'mediaSplit' }` → CRM toast reads *"Unknown block type 'mediaSplit' — refresh to reset."* The block still renders correctly in the CRM (offline fallback keeps it in localStorage), but the user can't persist or publish the page.

## Full canonical list (post-fix)

```
hero          richText      eventList     honourBoard
gallery       contactForm   membershipCta ctaBanner
mediaSplit    sectionTitle  pullQuote     featureGrid
faqAccordion  fullBleedImage timeline     twoColumn
divider
```

17 types in total.

## Notes

- No migration needed. `layout_draft` / `layout_published` are `jsonb`; existing rows with the original 8 types stay valid.
- If the whitelist is used anywhere else (publish endpoint validation, seed-layout generator, admin tools), please update those too.
- Frontend also lives at `packages/content-blocks/src/types.ts` (`BlockType` union) — that's the source of truth for the client. Keep this brief in sync if you add more types later.

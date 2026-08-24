# Block type — `eventsCalendar`

**Feature:** identical one-liner to brief 32. The CRM now offers an `eventsCalendar` block on the `/events` page palette — the full-month calendar UI matching the Paper "What's on the greens" design, backed by brief 33's public endpoints. `PATCH /clubs/:clubId/pages/:pageSlug` still rejects it as `unknown_block_type` on every autosave.

**Related:** brief 19 (previous whitelist bump — 9 editorial blocks), brief 32 (honourBoardSearch whitelist bump), brief 33 (public events endpoints — already shipped).

**Status:** requested — CRM ships the block; every autosave 400s until backend adds the type.

---

## What needs to change

Extend the whitelist on `PATCH /clubs/:clubId/pages/:pageSlug` (and any other block-validating endpoint) to accept:

- `eventsCalendar`

One entry, on top of the current 18 (8 original + 9 from brief 19 + `honourBoardSearch` from brief 32).

## Props (opaque to the server)

For reference — client-side `props` shape (server treats `props` as opaque JSON, no need to validate structure):

```ts
interface EventsCalendarProps {
  eyebrow?: string
  heading?: string        // default: "What's on the greens."
  description?: string
  highlightsCount?: number   // default: 4
  showIcalExport?: boolean   // default: true
}
```

## Verification

```bash
curl -X PATCH 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/3/pages/events' \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "layout_draft": {
      "blocks": [
        {
          "id": "blk_test",
          "type": "eventsCalendar",
          "props": { "heading": "What'\''s on the greens." }
        }
      ]
    }
  }'
```

Expect **200** with the standard patch response, not **400 `unknown_block_type`**.

## Contact

`#torny-eng`. Same file backend touched for briefs 19 and 32.

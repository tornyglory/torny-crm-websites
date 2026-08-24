# Block type — `honourBoardSearch`

**Feature:** one-line follow-up to brief 19. The CRM now offers a `honourBoardSearch` block on the `/honour-board` page palette — the full searchable "wall of names" table backed by brief 31's public endpoints. The `PATCH /clubs/:clubId/pages/:pageSlug` block-type whitelist still rejects it as `unknown_block_type`, so any user who drops it on a page can't autosave or publish.

**Related:** brief 19 (previous whitelist bump — the 9 editorial blocks), brief 31 (public honour-board endpoints — already shipped).

**Status:** requested — CRM ships the block; every autosave 400s until backend adds the type.

---

## What needs to change

Extend the whitelist on `PATCH /clubs/:clubId/pages/:pageSlug` (and any other block-validating endpoint) to accept:

- `honourBoardSearch`

That's it — one entry, on top of the current 17 (8 original + 9 from brief 19).

## Props (opaque to the server)

For reference — the client-side `props` shape (server treats `props` as opaque JSON, so no need to validate structure):

```ts
interface HonourBoardSearchProps {
  eyebrow?: string
  heading?: string        // default: "The honour board."
  description?: string    // default: full sentence
  pageSize?: number       // 10..100, defaults to 50
}
```

## Why not just make the server permissive?

Same reason as brief 19 §"Why not remove the whitelist entirely" — the guard catches old-client / attacker injection of arbitrary JSON into the layout. Cheap safety, tiny coordination cost per new block type.

## Verification

```bash
# Post a page layout containing a honourBoardSearch block
curl -X PATCH 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/3/pages/honour-board' \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "layout_draft": {
      "blocks": [
        {
          "id": "blk_test",
          "type": "honourBoardSearch",
          "props": { "heading": "The honour board." }
        }
      ]
    }
  }'
```

Expect **200** with the standard patch response, not **400 `unknown_block_type`**.

## Contact

`#torny-eng`. One-liner change — same file as brief 19's fix.

# Accept custom page slugs on block-image + block-video uploads

**Feature:** the `blockImages` and `blockVideos` upload handlers currently 400 with `unknown_page_slug` on any page the club has minted since onboarding (anything other than the 6 original system pages). Admins can create custom pages via the editor and build blocks on them, but can't upload any media onto those blocks.

**Status:** backend not started. Reproducible today — open a custom page (e.g. `venue-hire`), add any block with an image or video slot, click upload → red "Unknown page slug" error from the server.

**Related briefs:**
- brief 18 (block-images) — the handler being updated.
- brief 58 (block-videos) — same handler pattern, same bug.
- brief 59 (block-type allowlist sync) — same class of problem: a hardcoded list on the backend that doesn't track what the pages API already accepts.

---

## 1. What's happening

The pages API (`PATCH /clubs/:cid/pages/:slug`) accepts any kebab-case slug the admin mints, documented explicitly on the FE:

```
packages/api-client/src/resources/pages.ts:12
 * `PageSlug` is now any kebab-case slug the club has minted — we keep the
 * old seed union around as a hint of what to expect, but the type widens
 * to `string` because clubs can create arbitrary custom pages.
```

But the image/video upload handlers appear to be stuck on the pre-custom-pages era:

```
POST → /clubs/42/pages/venue-hire/blocks/blk_xyz/images/upload-url
← 400  { code: "unknown_page_slug" }
```

Likely cause: a hardcoded tuple like `KNOWN_PAGE_SLUGS = ('home', 'about', 'membership', 'events', 'honour-board', 'contact')` that was correct when written and never updated when custom pages shipped. Same shape as the block-type allowlist in brief 59.

---

## 2. The fix

Replace the hardcoded tuple with a DB lookup against the existing `page_layouts` table (or wherever custom pages are stored):

```python
# before
if page_slug not in KNOWN_PAGE_SLUGS:
    return error(400, "unknown_page_slug")

# after
if not db.page_layouts.exists(club_id=club_id, slug=page_slug, deleted_at=None):
    return error(404, "page_not_found")
```

Note the error-code bump: `unknown_page_slug` is misleading if the slug is *valid* for custom pages, we just don't have one yet. `page_not_found` with 404 is more accurate and matches the standard REST pattern (the resource at that URL doesn't exist).

If keeping the old code is easier for FE compatibility, that works too — the FE handler can swap on the next release.

---

## 3. Where this needs applying

Both resources have the same handler pattern — fix both in the same PR:

| Endpoint | Current symptom |
|---|---|
| `POST /clubs/:cid/pages/:slug/blocks/:bid/images/upload-url` | 400 `unknown_page_slug` on custom slugs |
| `POST /clubs/:cid/pages/:slug/blocks/:bid/images/confirm` | Likely same (hasn't been reproduced because step 1 fails first) |
| `GET  /clubs/:cid/pages/:slug/blocks/:bid/images` | Likely same |
| `DELETE /clubs/:cid/pages/:slug/blocks/:bid/images/:id` | Likely same |
| `POST /clubs/:cid/pages/:slug/blocks/:bid/video/upload-url` | 400 `unknown_page_slug` on custom slugs |
| `POST /clubs/:cid/pages/:slug/blocks/:bid/video/confirm` | Same |
| `GET  /clubs/:cid/pages/:slug/blocks/:bid/video` | Same |
| `DELETE /clubs/:cid/pages/:slug/blocks/:bid/video` | Same |

Please audit all 8 — the fix is identical, so this is a single-function change applied in a shared validator.

---

## 4. Why this is safe

Same reasoning as brief 59 (block types):
- The `page_layouts` table is already the source of truth for which slugs exist for a club. The pages API already uses it.
- Admin+ is already enforced upstream — the attacker's reach is their own club's own pages.
- No new client surface — the FE already sends the right slug (it only knows about pages it fetched from `GET /clubs/:cid/pages`).

---

## 5. Scope not included

- Prop-shape validation per block type (brief 59 covered that this isn't on the table).
- Changing the pages API itself — it's already correct.
- FE handling of the new `page_not_found` error code (if you choose to bump it). We'll update `blockImages` / `blockVideos` resource type definitions to add the new code in a follow-up; the current `unknown_page_slug` handling continues to work as a safety net.

---

## 6. Open questions

1. **Is this validator duplicated across image + video handlers, or shared?** If shared, one change fixes everything. If duplicated, please pull it into a shared utility while you're in there.
2. **Any other endpoints that take `page_slug` in the path?** Grep the backend repo for `page_slug` and audit the lot — this bug may surface elsewhere once custom pages become common.
3. **Should deleted / tombstoned custom pages 404 or 410?** Current behaviour unknown; 404 is probably fine for consistency with "it just doesn't exist."

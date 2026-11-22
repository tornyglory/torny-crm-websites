# Brief 113 — `customAi` block type (Custom · AI)

**Scope:**
- API (CRM stack): accept the new `customAi` block type on `PATCH /clubs/:id/pages/:slug` + the publish endpoint. No new table — the block lives inside `public_site_pages.layout_draft` / `.layout_published` like every other block.
- API (CRM stack): mild sanitisation of the author-supplied HTML/CSS/JS fields on save so a paste can't bypass the FE's defences.
- API (any stack, phase B): take over the Gemini proxy from the Nuxt prototype so the `GEMINI_API_KEY` moves onto the Lambda env and we can rate-limit per user.
- Nuxt club-sites (`apps/club-sites`): tenant-fetch endpoint needs to pass the new block type through untouched (should already — the renderer tolerates unknown types, but confirm).

**Prereq:** brief 17 (page builder persistence) shipped.

> **What triggered this brief:** FE shipped a Custom · AI block — Gemini-generated HTML/CSS/(optional) JS that the admin can drop into any page. Autosave rejects with `code: unknown_block_type, type: "customAi"`, so the block can't persist. Screenshot attached to the ticket shows the toast.

---

## 1. The ask

Add `customAi` to the block-type allow-list on the page save + publish endpoints. That's it for Phase A — the block renders fine once it round-trips through save → fetch → public site.

Phase B (separate PR, no deadline) migrates the Gemini proxy off Nuxt onto the Lambda stack so the API key stops living in the public-sites Worker and we can gate generations behind a per-user rate limit.

---

## 2. Block shape

```json
{
    "id": "blk_m1h2a3xy",
    "type": "customAi",
    "props": {
        "html": "<section class=\"hero\">…</section>",
        "css": ".hero { background: #0A0A0B; … }",
        "js": null,
        "allowJs": false,
        "aiNotes": "A dark hero with a bowls-green gradient and a pill CTA using the club accent.",
        "promptHistory": [
            {
                "at": "2026-11-22T22:14:08Z",
                "prompt": "A hero section with a bowls image on the right and a 'Join the club' button on the left",
                "model": "gemini-2.5-flash"
            }
        ]
    }
}
```

Field constraints (reject with `invalid_block_shape` + `field` pointer on violation, same shape brief 17 uses today):

| field | type | max | required | notes |
|---|---|---|---|---|
| `html` | string | 50 000 chars | **yes** | May be empty on a newly-added block (admin hasn't generated yet). Empty is valid. |
| `css` | string | 20 000 chars | yes | Can be empty. |
| `js` | string \| null | 5 000 chars | no | Treat empty string as null. Only honoured client-side when `allowJs === true`. |
| `allowJs` | boolean | — | no | Defaults to `false`. |
| `aiNotes` | string \| null | 500 chars | no | 1-2 sentence description Gemini returns. |
| `promptHistory` | array | max 10 entries | no | Each entry: `{ at: ISO 8601, prompt: string ≤ 4000, model?: string ≤ 60 }`. Oldest entries evicted FE-side before send. |

---

## 3. Sanitisation on save

FE strips `<script>` / `<style>` tags at render time and scopes all CSS selectors to a per-block attribute, so the author's CSS can't leak to the rest of the page. That's defence-in-depth, not a trust boundary. The backend is still the single source of truth for what gets persisted.

**Required on save** (regex / string-replace is fine — no need for a full HTML parser):

- `html`: strip `<script>…</script>` blocks (match is non-greedy, case-insensitive, handles newlines). Strip `on*=` attributes (`onclick`, `onload`, `onerror`, etc.). Strip `<iframe>` tags. Leave everything else — `img`, `svg`, `form`, `details`, custom data attrs are all fine.
- `css`: strip `expression(…)` and `javascript:` URLs. Leave the rest — scoping is the FE's job.
- `js`: pass through verbatim. The renderer only executes it inside `new Function('root', js)(root)` and only when `allowJs === true`; the backend doesn't need to parse it.

If any of the three fields change length by >5% after sanitisation, emit an audit log row so we can spot admins trying to paste in `<script>` and understand whether we need stronger UX about it.

**Not required**: HTML tag allow-listing, CSS property allow-listing, iframe-sandboxing. Admins are trusted — the risk is self-griefing their own site, not cross-tenant XSS (CSS is scoped, cookies are HttpOnly).

---

## 4. Payload size

Current `payload_too_large` threshold is 200 KB for the whole page layout. One Custom · AI block maxes at ~75 KB (50k html + 20k css + 5k js). Three stacked blocks tips over 200 KB.

Bump the limit to **500 KB** on `PATCH .../pages/:slug`. Pages with more content than that are a different problem.

---

## 5. Phase B — move the Gemini proxy to the Lambda backend

Today the FE calls `POST https://sites.torny.club/api/ai/generate-block` (a Nuxt server route in `apps/club-sites`). The `GEMINI_API_KEY` lives in the club-sites Worker's env. This works but is architecturally weird — the CRM talks to the public-sites server for an AI feature, not the CRM backend.

When you have cycles, move it to the Lambda stack:

- New endpoint `POST /clubs/:cid/ai/custom-block/generate` on the CRM base (the one the rest of the CRM already talks to).
- Request body: identical to the existing Nuxt route — see `packages/api-client/src/resources/ai.ts` for the TypeScript types (`GenerateBlockInput`). The exact shape:
    ```json
    {
        "prompt": "…",
        "brand": { "club_name": "…", "accent_color": "#…", … },
        "nearby_blocks": [{ "type": "hero", "title": "…", "text": "…" }],
        "iteration": { "prev_html": "…", "prev_css": "…", "prev_js": null } | null,
        "allow_js": false
    }
    ```
- Response (success): `{ status: "success", data: { html, css, js, notes } }`.
- Error codes to preserve: `missing_prompt`, `prompt_too_long`, `gemini_failed`, `gemini_bad_shape`, `gemini_empty`, `misconfigured`. FE maps these directly.
- **Rate limit**: 20 generations per user per hour — enough for iterative "make it bigger / change the colour" loops without burning hours of budget on a stuck admin.
- Model: `gemini-2.5-flash`. Structured output via `responseMimeType: application/json` + `responseSchema` (see the Nuxt handler at `apps/club-sites/server/api/ai/generate-block.post.ts` for the schema and system prompt — port both verbatim).
- `GEMINI_API_KEY` moves to the Lambda env. Nuxt env var gets deleted in the same PR that ships the new endpoint.

FE changes required when this ships: point `SITES_BASE` → `CRM_BASE` in `packages/api-client/src/resources/ai.ts` and delete the fallback. One-line swap, no rendering changes.

---

## 6. Verification checklist

Phase A:

- `PATCH /clubs/:cid/pages/home` with a layout that includes `{ type: "customAi", props: { html: "<h1>Hi</h1>", css: "", js: null, allowJs: false } }` → 200, draft persists.
- `GET /public/clubs/:slug/site` round-trips the block unchanged (same `type`, same `props`).
- `POST .../pages/home/publish` → the block appears in `layout_published` and lands on the public site.
- `PATCH` with `html` length > 50 000 → `invalid_block_shape` with `field: "html"` and a useful message.
- `PATCH` with `html: "<p>safe</p><script>alert(1)</script>"` → 200; stored `html` has the `<script>` stripped.
- `PATCH` with `html: "<a onclick=\"x\">link</a>"` → 200; stored `html` is `"<a>link</a>"`.
- `PATCH` with a 400 KB `html` across three blocks → 200 (post-bump). Same payload under the old 200 KB limit was rejected.
- `PATCH` with `promptHistory` containing 11 entries → `invalid_block_shape` (FE trims to 10, so this is a defensive check).

Phase B:

- `POST /clubs/:cid/ai/custom-block/generate` with a well-formed body returns `{ status: "success", data: { html, css, js, notes } }`.
- Missing or wrong bearer → 401 with `code: unauthenticated`.
- Empty prompt → 400 with `code: missing_prompt`.
- Prompt > 4000 chars → 400 with `code: prompt_too_long`.
- Gemini outage → 502 with `code: gemini_failed`.
- 21st generation in an hour (same user) → 429 with `code: rate_limited`.
- Nuxt route at `/api/ai/generate-block` returns a 410 (gone) with a note pointing to the new endpoint, or is deleted entirely once FE has switched over.

---

## 7. Non-goals

- Server-side CSS auto-scoping. FE already does this per block id — doing it again on the backend would double the output size without extra safety.
- Content moderation of the generated HTML. If a bored admin asks Gemini for something off-brand, that's a people problem, not a backend problem.
- Storing the generations themselves for analytics. `aiNotes` + `promptHistory` are enough for the admin's UI; if Product wants aggregate "what are clubs generating" telemetry later, that's a separate brief.
- A new table. The block lives in the existing `layout_draft` / `layout_published` JSON blobs — adding a `custom_ai_blocks` row would just split the source of truth.

---

## 8. Context links for the backend engineer

- FE renderer (CSS scoping + JS execution model): `packages/content-blocks/src/blocks/CustomAiBlock.vue`
- FE block type + schema: `packages/content-blocks/src/types.ts` (search for `CustomAiProps`)
- Autosave path that's failing today: `apps/crm/src/views/website/WebsiteEditorView.vue` → `autosave()` around line 1290 — uses `pages.patch()` from `packages/api-client/src/resources/pages.ts`
- Nuxt Gemini proxy (reference for Phase B): `apps/club-sites/server/api/ai/generate-block.post.ts`
- `GEMINI_API_KEY` currently lives in `apps/club-sites/.env` (Cloudflare Pages Worker env in prod)

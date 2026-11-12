# Brief 103 — Signature persistence + WYSIWYG composer wiring

**Scope:**
- CRM FE (`apps/crm` + `packages/content-blocks`): TipTap-based RichTextEditor shipped (see §6), wired into SendEmailModal + the new Settings → Email signatures panel. Both signature surfaces read / write through `useEmailSignatures` which currently stubs on localStorage — this brief replaces the stub with real GET/PUT endpoints.
- API (`general` repo): two columns + four endpoints + a small send-path change. All low-risk, additive, reuses the existing bulkEmail dispatch.

**Prereq:** none for the FE (already shipped), but brief 102 and brief 101 are the surrounding design — brief 101 for the custom sender identity and reply-capture, brief 102 for the composer in-thread flow. Brief 103 is the piece that makes signatures survive a page reload and makes sent emails carry the signature the admin saw in the preview.

---

## 1. The ask

The CRM now shows a working WYSIWYG composer on the Send email modal and a two-card manager page at **Settings → Email signatures**. Three things are needed from the backend to make the loop close:

1. **Persist signatures server-side.** `users.email_signature_html` + `clubs_data.email_signature_html` columns, plus GET / PUT endpoints keyed off the current session (user) and current club.
2. **Append signatures on send.** The admin sees a preview strip under the composer that stitches `body → personal → club footer`. Today the stitching happens client-side in `useEmailSignatures.stitchSignature()` and goes out as the `body_html` payload. Preferred long-term: the bulk-email endpoint accepts a `use_signature: true` flag and does the stitch server-side so (a) every send path gets consistent sig handling without the FE having to remember, and (b) the signature can be refreshed without re-composing the email.
3. **Sanitise the stored HTML.** Both signature columns accept arbitrary HTML from the admin's editor. The endpoint has to sanitise aggressively — these values get embedded verbatim in every outbound email, so a stored `<script>` is a stored XSS vector against every member.

---

## 2. Why

- **Signatures are the main thing missing from brief 101's email story.** Brief 101 gave each club a verified sender; brief 103 lets the person inside the club actually sign their name without re-typing it on every send.
- **The composer is already live — see commit on `main`.** Admins clicking Send today get the signatures stitched in from localStorage. That works for one browser on one device but breaks the moment they switch machines. The whole point of saved signatures is they follow the user.
- **One trust boundary beats several.** Centralising the HTML sanitiser at the endpoint boundary (brief 102 §5.2 already specifies the allowlist) means every consumer — this brief's PUT endpoints, brief 102's reply composer, any future surface — gets the same safety.

---

## 3. Data model

### 3.1 `users` — one new column

| Column | Type | Note |
|---|---|---|
| `email_signature_html` | `TEXT NULL` | Sanitised HTML. Null = no personal sig. |

Max 4 KB after sanitising (enforced at the endpoint, not the column type). A full personal sig — name, role, phone link, maybe a small avatar `<img>` — fits comfortably.

### 3.2 `clubs_data` — one new column

| Column | Type | Note |
|---|---|---|
| `email_signature_html` | `TEXT NULL` | Club-wide footer. Runs under every admin's personal sig. |

---

## 4. Endpoints

### 4.1 `GET /users/me/email-signature`

**Auth:** any authenticated user.

```json
200 { "status": "success", "data": { "html": "<p>Nev · Secretary</p>" } }
```

Returns `{ html: null }` when unset. No 404 — the empty state is a valid value.

### 4.2 `PUT /users/me/email-signature`

```json
{ "html": "<p>Nev · Secretary · <a href=\"tel:0211234567\">0211234567</a></p>" }
```

**Validation / sanitise:**
- Max 4 KB after sanitisation. Over → `413 signature_too_large`.
- Allowlist tags: `p, br, strong, em, u, a, img, ul, ol, li, span`.
- Allowlist attributes:
  - `a`: `href` only. Rewrite scheme — only `http`, `https`, `mailto`, `tel` allowed. All others stripped. Force `rel="noopener"`.
  - `img`: `src` only. Must be `https://`. `src="data:…"` stripped. `max-height: 80px` added inline.
  - `span`: `style` only, further restricted to `color`, `background-color`, `font-weight`, `font-style`, `text-decoration`, `font-size` (≤ 24px).
- Strip `<script>`, `<style>`, inline `on*` handlers, `javascript:` URLs, CSS `expression(…)` and `@import`.
- `{ html: null }` clears the stored value. Explicit — can't delete via DELETE.

```json
200 { "status": "success", "data": { "html": "<p>Nev · Secretary · <a href=\"tel:0211234567\" rel=\"noopener\">0211234567</a></p>" } }
```

**Error codes:**

| Code | HTTP | When |
|---|---|---|
| `signature_too_large` | 413 | Over 4 KB post-sanitise. |
| `signature_invalid` | 422 | Content so stripped that nothing's left — surfaces as "That signature doesn't have anything safe to send." |

### 4.3 `GET /clubs/{club_id}/email-signature`

**Auth:** any member of the club. Same shape as §4.1.

### 4.4 `PUT /clubs/{club_id}/email-signature`

**Auth:** owner or admin (anyone with `settings:write` permission). Same validation as §4.2 with one addition:

- `403 forbidden` when the caller lacks `settings:write`. The FE respects this already — `EmailSignaturesPanel.vue` hides the editor behind `signatures.isOwnerOrAdmin` and renders a read-only preview for team members.

Same error codes plus `forbidden`.

---

## 5. Send-path change — `POST /clubs/{club_id}/bulk-email`

Extend the existing endpoint with one new optional flag:

```json
{
    "subject": "What's new at Naenae this month",
    "body_html": "<p>Hi {{recipient_first_name}},</p>…",
    "recipients": { "mode": "ids", "user_ids": [1, 2, 3] },
    "use_signature": true
}
```

When `use_signature: true`:

1. Load `users.email_signature_html` for the calling user.
2. Load `clubs_data.email_signature_html` for the club.
3. Append in order: `body_html` → `<div class="torny-signature">{personal}</div>` → `<hr /><div class="torny-club-footer">{club}</div>` (omit either div if its source is null).
4. The resulting HTML goes through the existing SES send path, with `{{tokens}}` substituted per-recipient as today.

When `use_signature: false` (or absent — default false for backwards compat): current behaviour unchanged.

**Why server-side stitching:** the FE currently stitches with `useEmailSignatures.stitchSignature()` and sends the combined HTML as `body_html`. That works but has two gotchas:

- If the admin updates their signature between composing and hitting Send, the stitched HTML reflects the pre-update sig. Moving the stitch server-side means the live DB value always wins.
- Other send paths (brief 102 reply composer, future transactional mail) can opt in with a one-line flag instead of duplicating the stitcher.

Both FEs ship the `use_signature: true` flag once this lands. Until then they keep stitching client-side — the flag is additive, not a required cutover.

---

## 6. CRM FE — already in place

Shipped on `main` ahead of this brief:

- `packages/content-blocks/src/components/RichTextEditor.vue` — TipTap v3, StarterKit + Underline + Link + Image + Placeholder. v-model → HTML. `size` prop for `md` (composer) vs `sm` (signature strip). Exposes `insertText()` so parents can drop merge tokens at the cursor.
- `apps/crm/src/components/modals/SendEmailModal.vue` — textarea swapped for `RichTextEditor`; signature preview strip under the editor; stitches personal + club sigs into `body_html` on send via `stitchSignature()`.
- `apps/crm/src/composables/useEmailSignatures.ts` — thin shim: `personal` + `club` refs, `savePersonal / saveClub`, `stitchSignature` helper. localStorage-backed today, swaps to the four §4 endpoints once this brief lands with no component-level changes.
- `apps/crm/src/views/settings/EmailSignaturesPanel.vue` — new Settings section `email-signatures`. Two cards (Personal + Club), both backed by RichTextEditor with in-context preview + Save/Clear. Owner/admin check on the club card via `useEmailSignatures().isOwnerOrAdmin`.

Nothing to rebuild on the FE side — brief 103 is purely about swapping the storage layer in `useEmailSignatures` from localStorage to the four endpoints in §4, plus flipping `use_signature: true` on the bulk-email call.

---

## 7. Verification

```bash
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # admin JWT
CLUB=5

# 1. Personal sig round-trip
curl -s -X PUT "$CRM/users/me/email-signature" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"html":"<p>Nev · Secretary · <a href=\"tel:0211234567\">0211234567</a></p>"}' | jq
# → 200 { html: "<p>Nev · Secretary · <a href=\"tel:0211234567\" rel=\"noopener\">...</a></p>" }

curl -s "$CRM/users/me/email-signature" -H "Authorization: Bearer $TOKEN" | jq '.data.html'
# → "<p>Nev · Secretary · <a href=\"tel:0211234567\" rel=\"noopener\">0211234567</a></p>"

# 2. XSS stripped at the boundary
curl -s -X PUT "$CRM/users/me/email-signature" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"html":"<p>Nev</p><script>alert(1)</script><a href=\"javascript:alert(1)\">x</a>"}' | jq '.data.html'
# → "<p>Nev</p>"   (script tag gone, javascript: link stripped)

# 3. Club sig — owner can PUT
curl -s -X PUT "$CRM/clubs/$CLUB/email-signature" -H "Authorization: Bearer $OWNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"html":"<p>Naenae Bowling Club · <a href=\"https://naenaebowls.nz\">naenaebowls.nz</a></p>"}' | jq
# → 200

# 4. Club sig — non-owner (player) is forbidden
curl -s -X PUT "$CRM/clubs/$CLUB/email-signature" -H "Authorization: Bearer $PLAYER_TOKEN" \
    -H "Content-Type: application/json" -d '{"html":"<p>x</p>"}'
# → 403 { code: "forbidden" }

# 5. Clear
curl -s -X PUT "$CRM/users/me/email-signature" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"html":null}' | jq '.data.html'
# → null

# 6. Send with use_signature stitches server-side
curl -s -X POST "$CRM/clubs/$CLUB/bulk-email" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"subject":"Test","body_html":"<p>Hi {{recipient_first_name}},</p>","recipients":{"mode":"ids","user_ids":[9981]},"use_signature":true}' | jq
# → 200 { sent_count: 1, ... }
# → received email: Hi Ruth, / Nev · Secretary / Naenae Bowling Club · naenaebowls.nz
```

---

## 8. Pass criteria

- ✓ GET returns `{ html: null }` for a user / club that's never set one — never 404.
- ✓ PUT round-trips sanitised HTML; `<script>`, `javascript:` URLs, inline `on*` handlers are gone.
- ✓ 4 KB post-sanitise ceiling; over → `413 signature_too_large`.
- ✓ Owner / `settings:write` admin can PUT the club sig; anyone else is `403 forbidden`.
- ✓ `use_signature: true` on bulk-email stitches `personal → club_footer` under the body with the same ordering the FE preview showed.
- ✓ `use_signature: false` / absent leaves behaviour unchanged for every current caller.
- ✓ FE swaps `useEmailSignatures` storage layer with ~20 lines of change (API calls replace localStorage reads/writes). No component signatures change.

---

## 9. Non-goals

- **Multiple saved signatures per user** (home, work, formal). Enough people asked that we can revisit, but not now.
- **Signature picker in the composer.** The FE preview shows the one saved personal sig; swapping on the fly is a separate brief.
- **Image upload into the signature.** Brief 102 §6 covers paste / drop-upload for the composer; the signature cards use `hide-image` on the RichTextEditor so there's no inconsistent "I can paste in my composer but not my sig" trap. Once brief 102's upload wiring lands, it's a one-line enable here.
- **Per-club multiple senders.** Brief 101 picks the sender; signatures don't add any new sender logic.
- **Reconciliation across sessions.** Last write wins. If two admins click Save on the club footer within a second of each other, the second one overrides the first. We accept this at today's team sizes.
- **Signature templates / starter library.** Admin pastes what they want.

---

## 10. Rollout

1. Backend ships §3 + §4 — FE picks it up by swapping the storage layer in `useEmailSignatures` (~20 LOC diff).
2. Backend ships §5 — FE swaps the client-side stitcher for `use_signature: true` on bulk-email + brief 102's reply endpoint when it lands.

Both steps are backwards-compatible. The FE can ship with either in-place without blocking.

---

## 11. Contact

Nev on Slack (`#torny-eng`). Backend: two columns + four CRUD routes + one flag on an existing endpoint, plus the sanitiser (copy from brief 102 §5.2's allowlist). Everything the FE needs is already in place and wired to a stubbed shim — swap the shim's impl and the whole thing lights up.

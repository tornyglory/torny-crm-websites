# Brief 102 — In-CRM reply composer + email signatures

**Scope:**
- CRM FE (`apps/crm` + `packages/content-blocks`): a TipTap-powered WYSIWYG composer sitting inline under each thread on Member detail → Communications. Image paste + upload, link insertion with click-tracking, personal + club signature management. The same editor replaces the current `v-html`-only `RichTextBlock` in the Website editor as a bonus.
- API (`general` repo): one endpoint — `POST /clubs/{club_id}/members/{user_id}/reply` — that sends an in-thread reply via existing bulk-email dispatch, plus two signature-storage columns (`users.email_signature_html`, `clubs_data.email_signature_html`), plus the usual GET + PATCH for each.

**Prereq:** brief 101 shipped (custom sender + inbound reply capture). Without it there's no thread to reply into — this brief is the *follow-up* that lets admins answer from inside Torny instead of logging into Gmail.

---

## 1. The ask

Once replies are landing in the CRM (brief 101), the obvious next step is to let admins reply *from* the CRM. Today the only answer is "open Gmail, find the forwarded copy, hit reply there" — which immediately breaks our centralised-thread story (that reply's text never comes back).

Three pieces:

1. **A proper composer.** Rich text (bold / italic / lists / links / images), not a textarea. Lives under the thread view, feels like a mini email client.
2. **Email signatures.** One personal (per-admin — their name + role), one club-wide (address, phone, unsubscribe footer). Composer stitches them in, admin can toggle either on/off per message.
3. **Reply dispatch.** Hits the same SES send path brief 101 built, with `In-Reply-To` / `References` headers set so the member's native inbox threads the reply back with the original.

---

## 2. Why

- **Centralised conversations.** The whole point of brief 101 collapses if the admin's reply doesn't come back through the system. Native-inbox replies are a dead end for CRM visibility.
- **Faster response.** An admin seeing a member's reply on the member detail page, replying there, and moving on is the whole point of a CRM. Context-switch to Gmail breaks flow.
- **Signatures are table-stakes.** Every other mail tool ships them. Running a committee means a lot of "— Nev, Secretary" closers; having that template-stored and auto-appended removes friction.
- **Images + links on public sites too.** The composer pulls double duty as the Website editor's rich-text block editor, which is currently a blind `v-html` paste. One component, two homes.

---

## 3. Editor choice

TipTap (v2, Vue 3). Rationale:

- Headless, so every control we render is our own Torny-styled button. No library CSS leak.
- Vue-native bindings (`@tiptap/vue-3`). No wrapper juggling.
- Extension model: ship only what we need (~15 KB gz for StarterKit + Link + Image + Placeholder), add more later without migrating.
- Output is HTML — same thing SES wants, same thing the `RichTextBlock` v-html's today. Zero intermediate format.
- Active maintenance, used by Notion, GitLab, Linear.

Rejected:

- **Lexical:** Meta-maintained, powerful, overkill for our scope + heavier.
- **Quill:** Old. Weird output format (Delta JSON). Less flexible theming.
- **Toast UI Editor:** Markdown-first. Clubs don't write markdown.
- **Rolling our own `contenteditable`:** Hell. See the Quirks Mode of 2007 if curious.

The component lives at `packages/content-blocks/src/components/RichTextEditor.vue` so the Website editor (which already imports from `content-blocks`) picks it up alongside the Composer.

---

## 4. Data model

### 4.1 `users` — one new column

| Column | Type | Note |
|---|---|---|
| `email_signature_html` | `TEXT NULL` | Sanitised HTML. Null = no personal signature. |

Max length enforced in the endpoint, not the column, so legitimate signatures (name + role + phone + optional image) fit comfortably but nobody pastes a whole email thread into it.

### 4.2 `clubs_data` — one new column

| Column | Type | Note |
|---|---|---|
| `email_signature_html` | `TEXT NULL` | Club-wide signature / footer. Appended after the personal signature. |

### 4.3 `member_communications` — no changes

Brief 101's `direction`, `thread_id`, `in_reply_to_communication_id` columns already carry everything a reply needs. This brief writes outbound rows into the same table with `direction='outbound'` and the same `thread_id` as the inbound row the admin is replying to.

---

## 5. Endpoint spec

### 5.1 `GET /users/me/email-signature`

**Auth:** any authenticated user.

```json
200 { "status": "success", "data": { "html": "<p>Nev · Secretary</p>" } }
```

Returns `{ html: null }` if unset.

### 5.2 `PUT /users/me/email-signature`

```json
{ "html": "<p>Nev · Secretary · <a href=\"tel:0211234567\">0211234567</a></p>" }
```

Validation:
- Max length 4 KB after sanitising.
- Sanitise via DOMPurify-equivalent on the backend (allowlist: `p, br, strong, em, u, a, img, ul, ol, li`; `href` rel-added; `img` must be `https:`).
- Reject any `<script>`, `<style>`, inline `on*` handlers, non-https image sources.

```json
200 { "status": "success", "data": { "html": "<p>Nev · Secretary · <a href=\"tel:0211234567\" rel=\"noopener\">0211234567</a></p>" } }
```

Send `{ "html": null }` to clear.

### 5.3 `GET /clubs/{club_id}/email-signature`

Same as §5.1 scoped to club. Any member of the club can read.

### 5.4 `PUT /clubs/{club_id}/email-signature`

Same as §5.2. Owner or admin with `settings:write`.

### 5.5 `POST /clubs/{club_id}/members/{user_id}/reply`

**Auth:** any member of the club with `communications:send` permission.

```json
{
    "thread_id": 442,
    "in_reply_to_communication_id": 7812,
    "subject": "Re: AGM Notice",
    "html": "<p>Thanks Nev, see you Thursday.</p>",
    "use_personal_signature": true,
    "use_club_signature": true
}
```

Steps:

1. Load the thread + verify `thread.club_id === :club_id` AND `thread.user_id === :user_id` (prevents cross-tenant stitching).
2. Load the source communication (`in_reply_to_communication_id`) for its `provider_message_id` → becomes our `In-Reply-To` + `References` header.
3. Compose final HTML: `body + personal_signature + club_signature` (each gated by the flags).
4. Sanitise the composed HTML (same allowlist as §5.2, plus the body gets through-sanitised too — admin isn't a trust boundary against themselves, but a compromised session could inject into other members' mailboxes).
5. Rewrite every `<a href>` through the existing click-tracker (`l.torny.co/<campaign_id>/<token>`).
6. Dispatch via the same SES path brief 101 uses:
   - `From`: the club's verified sender (brief 101) or fallback `noreply@torny.com`.
   - `To`: the member's email.
   - `Reply-To`: `thread+<token>@replies.torny.co` — same token as the thread, so the member's counter-reply lands in the same thread.
   - `In-Reply-To`: `<message-id of source>`.
   - `References`: all prior message-ids in the thread, space-separated.
   - `Subject`: as provided.
7. Insert a `member_communications` row: `direction='outbound'`, `thread_id`, `in_reply_to_communication_id`, `body=<sanitised html>`, `channel='email'`, `status='queued'`.
8. Bump `communication_threads.reply_count`, update `last_reply_at`.
9. Return the new row.

```json
201 {
    "status": "success",
    "data": {
        "communication_id": 7813,
        "status": "queued",
        "sent_at": "2026-11-12T01:14:00Z",
        "thread_id": 442,
        "in_reply_to_communication_id": 7812
    }
}
```

Error codes:

| Code | HTTP | When |
|---|---|---|
| `thread_not_found` | 404 | No such thread, or thread belongs to another club / member. |
| `source_not_found` | 404 | `in_reply_to_communication_id` not in this thread. |
| `html_required` | 400 | Empty body. |
| `html_too_large` | 413 | Over 64 KB after sanitising. |
| `signature_too_large` | 413 | Stitched signature pushes the whole payload over 128 KB. |
| `recipient_bounced` | 409 | Member is on `email_status='bounced'` — refuse to send. |
| `recipient_unsubscribed` | 409 | Member unsubscribed. |
| `forbidden` | 403 | Caller lacks `communications:send`. |

---

## 6. Image handling

TipTap's Image extension takes a `src`. We extend it:

1. **Paste or drag an image** → intercept, upload to the existing media endpoint (`POST /media/upload`), get a CDN URL, insert `<img src="{url}" alt="" />`.
2. **Max size 5 MB** per image — enforced in the upload endpoint, surfaced as a toast on failure.
3. **Formats:** PNG / JPG / GIF / WebP. SVG blocked (XSS vector).
4. **CDN URL is absolute** so the image survives the email render. No relative paths, no auth-gated links, no `blob:` URLs.
5. **Transit through the sanitiser:** final send-path sanitiser verifies `img.src` is one of our known CDN hostnames. External images (someone pasting an image URL from elsewhere) are allowed but logged for review — spammers love hot-linking.

---

## 7. CRM FE — the composer

### 7.1 Location

Member detail → Communications tab → each thread row. When a thread is expanded (showing prior inbound + outbound messages), a composer appears at the bottom with the body pre-focused.

Standalone compose (not replying to a specific thread) is a separate brief — this one is reply-only.

### 7.2 Component tree

```
<ReplyComposer thread-id="442" source-communication-id="7812" />
  ├── <RichTextEditor v-model="html" />  (TipTap in packages/content-blocks)
  │     ├── toolbar: bold / italic / underline / list / link / image / code / clear
  │     ├── editable area
  │     └── placeholder: "Write a reply…"
  ├── <SignatureToggles>
  │     ├── Use my signature  (bound to users.email_signature_html)
  │     └── Use club footer   (bound to clubs_data.email_signature_html)
  ├── <SignaturePreview>  (muted, below body — shows what will be appended)
  └── Send button + Discard button
```

### 7.3 Settings surfaces

Two new cards under Settings:

- **Settings → Profile → Email signature** — personal signature editor. Same TipTap component. Live preview.
- **Settings → Club & brand → Email footer** — club-wide signature editor. Owner / admin only.

Both use `PUT /users/me/email-signature` and `PUT /clubs/:id/email-signature` respectively.

### 7.4 Keyboard

- `Cmd/Ctrl+Enter` sends.
- `Esc` discards after a confirm (only when there's unsaved content).
- `Cmd/Ctrl+K` opens the link insert popover (TipTap default).

### 7.5 "Also forward to" from brief 101

If the club has `default_reply_to` set (brief 101 §5.1), the composer shows a muted "A copy of this reply will also go to secretary@naenaebowls.nz." line below the Send button. Just a confirmation — no checkbox, inherits from the club setting.

---

## 8. Website editor retrofit (bonus)

The current `RichTextBlock` in `packages/content-blocks` is render-only (`v-html`). Admins editing a block paste raw HTML or type into a bare textarea. Replace with the new `RichTextEditor`:

- `RichTextBlock.vue` stays render-only (public site doesn't need the editor).
- New `RichTextEditor.vue` beside it handles editing.
- `apps/crm/src/views/website/WebsiteEditorView.vue` wires it up for `richText` block editing. One-line swap of the textarea for `<RichTextEditor v-model="props.html" />`.

No schema change — the block already stores HTML. Admins get bold / italic / lists / links / images across the whole Website editor for free.

---

## 9. Verification

```bash
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # admin JWT
CLUB=5

# 1. Set personal signature
curl -s -X PUT "$CRM/users/me/email-signature" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"html":"<p>Nev · Secretary · <a href=\"tel:0211234567\">0211234567</a></p>"}' | jq
# → 200 { html: "<p>Nev · Secretary · <a href=\"tel:0211234567\" rel=\"noopener\">...</a></p>" }

# 2. Set club signature
curl -s -X PUT "$CRM/clubs/$CLUB/email-signature" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"html":"<p>Naenae Bowling Club · 54 Pokohiwi Road · <a href=\"https://naenaebowls.nz\">naenaebowls.nz</a></p>"}'

# 3. Reply in a thread
curl -s -X POST "$VENUE/clubs/$CLUB/members/9981/reply" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{
          "thread_id": 442,
          "in_reply_to_communication_id": 7812,
          "subject": "Re: AGM Notice",
          "html": "<p>Thanks Ruth, see you Thursday.</p>",
          "use_personal_signature": true,
          "use_club_signature": true
        }' | jq
# → 201 { communication_id: 7813, status: "queued", thread_id: 442 }

# 4. Member receives mail with In-Reply-To + References set, Gmail/Outlook threads it.

# 5. XSS attempt in body
curl -s -X POST "$VENUE/clubs/$CLUB/members/9981/reply" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"thread_id":442,"in_reply_to_communication_id":7812,"subject":"x","html":"<script>alert(1)</script>"}'
# → 201, but the stored html is sanitised empty — no <script> tag goes out.

# 6. Bounced recipient blocks
curl -s -X POST "$VENUE/clubs/$CLUB/members/<bounced_user>/reply" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"thread_id":99,"in_reply_to_communication_id":99,"subject":"x","html":"<p>x</p>"}'
# → 409 { code: "recipient_bounced" }

# 7. Image upload via existing media endpoint, then reference in body
#    (handled transparently by the TipTap image extension — no new endpoint)
```

---

## 10. Pass criteria

- ✓ TipTap composer renders bold / italic / lists / links / images with a Torny-styled toolbar.
- ✓ Signatures stitch in the right order (body → personal → club), and either can be toggled off per-send.
- ✓ XSS payloads in the body OR a signature are stripped by the backend sanitiser before send.
- ✓ Images pasted / dropped into the composer upload to the Torny CDN and round-trip into the email with absolute URLs.
- ✓ Sent reply shows up in the thread immediately (optimistic) and reconciles with the server row.
- ✓ `In-Reply-To` + `References` headers thread the reply with the original on the recipient's native client.
- ✓ Bounced / unsubscribed recipients are refused at the API before any SES call.
- ✓ The same editor component swaps into the Website editor's `richText` block — bold / italic / links / images work there too.

---

## 11. Non-goals

- **Drafts.** Reply either sends or discards. Draft persistence is a separate brief — tempting but adds state + cross-tab sync.
- **Scheduled sends.** No "send Monday at 9am" from a reply. Campaign-level only.
- **Thread-level mute / snooze.** Stays in the Communications tab regardless.
- **Full inbox UI across all members.** Per-member thread view only.
- **Reply quoting.** No auto-quoted "> Previous message" block. The recipient's client handles threading; we don't need to recapitulate.
- **Translation / tone suggestions / AI assist.** Future brief.
- **Separate reply TO distinct recipients in the same message.** One member per thread, one thread per reply.
- **HTML email templating from this composer.** Templates are managed via the existing Campaign / Template editor; reply composer is for ad-hoc text.

---

## 12. Rollout notes

- Ship the `RichTextEditor` component first (zero backend prereqs). Swap it into the Website editor as the proving ground.
- Then signature endpoints + settings pages. Admins can set their signatures in advance of the composer existing.
- Then `POST /members/:id/reply` — and the composer wires up end-to-end.
- The composer is useless until brief 101's threading infra ships. Explicit dependency, flagged in both briefs.

---

## 13. Contact

Nev on Slack (`#torny-eng`). Backend: one endpoint + two columns + four CRUD routes for signatures, lean on brief 101's send path. FE: one TipTap-based component in `content-blocks`, one composer in `apps/crm/src/components/`, two settings cards. Website editor retrofit is a one-line swap.

Suggested ship order after brief 101 lands:
1. `RichTextEditor` in `content-blocks` (standalone, no backend).
2. Signature CRUD endpoints + Settings cards.
3. `POST /members/:id/reply` + ReplyComposer on the thread view.
4. Website editor retrofit.

# Brief 101 — Email threading (Gmail-style conversation view) in the CRM

**Scope:**
- FE (`tornyglory/torny-crm-websites`, `apps/crm`): render the member Communications timeline with threaded emails. Click any email → expands into a Gmail-style conversation view showing every related message (ancestors above, siblings below). Add a Reply button that sends through SES and threads correctly.

**Prereq:** Brief 100 shipped (per-club inbox live, inbound emails landing as `member_communications` rows with `channel = 'email_inbound'`).

> **Backend status (2026-11-13):** All endpoints shipped. Message-ID
> generation on outbound, thread_id denormalization, inbound threading
> resolution, GET /thread endpoint, POST /reply endpoint — all live.

---

## 1. The ask

The Communications tab on a member's page currently renders each row in isolation: notes, outbound broadcasts, inbound emails, etc. For emails specifically, that's confusing — a reply arrives without visible context. Users expect Gmail-style:

- Click an email → expand into a conversation view.
- Conversation shows every message in the thread, oldest-first (or newest-collapsed).
- Each message tagged inbound vs. outbound.
- **Reply** button on the expanded view — composes, sends through our SES identity, lands back in the timeline without a page refresh.

All the data to do this exists. The two API endpoints below give you the thread and the reply action.

---

## 2. Why

- **Inbound-only context is confusing.** When a member replies "thanks" with no quoted body, the admin has no idea what they're thanking you for. Threading surfaces the full conversation.
- **Replies need to actually thread.** When an admin clicks Reply in the CRM, the member's email client (Gmail / Outlook) must group the reply under the original. That means the outbound must carry `In-Reply-To` + `References` headers pointing at our original Message-ID. The backend handles that automatically — FE just passes the parent `comm_id`.
- **Everything's already stored.** Backend writes `thread_id`, `message_id`, `in_reply_to`, `parent_communication_id` on every row. Thread lookup is a single indexed query.

---

## 3. API — two endpoints

Both live on the **Venue API** base URL:

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

### 3.1 `GET /clubs/{club_id}/communications/{comm_id}/thread` — load the conversation

```http
GET /clubs/5/communications/42/thread
Authorization: Bearer <JWT>
```

**Auth:** any CRM role (owner/admin/member).

**Response:**
```json
200 {
    "status": "success",
    "data": {
        "thread_id":  "<abc@torny.pro>",
        "anchor_id":  42,
        "messages": [
            {
                "communication_id":        40,
                "direction":               "outbound",
                "channel":                 "email",
                "subject":                 "Welcome to Naenae Bowling Club",
                "body":                    "...",
                "body_html":               "<p>...</p>",
                "message_id":              "<abc@torny.pro>",
                "in_reply_to":             null,
                "parent_communication_id": null,
                "from_name":               null,
                "from_email":              null,
                "sent_by":                 12,
                "user_id":                 87,
                "sent_at":                 "2026-11-10T22:00:00Z",
                "received_at":             null,
                "status":                  "sent"
            },
            {
                "communication_id":        42,
                "direction":               "inbound",
                "channel":                 "email_inbound",
                "subject":                 "Re: Welcome to Naenae Bowling Club",
                "body":                    "Thanks! See you Tuesday.",
                "body_html":               null,
                "message_id":              "<def@gmail.com>",
                "in_reply_to":             "<abc@torny.pro>",
                "parent_communication_id": 40,
                "from_name":               "Jane Doe",
                "from_email":              "jane@example.com",
                "sent_by":                 null,
                "user_id":                 87,
                "sent_at":                 null,
                "received_at":             "2026-11-11T09:14:00Z",
                "status":                  "logged"
            }
        ]
    }
}
```

**Ordering:** chronological, oldest first, using `COALESCE(received_at, sent_at)`.

**Direction field** is pre-computed server-side so you don't have to inspect `channel`. Just render differently based on `direction === 'inbound'` vs `'outbound'`.

**Error codes:**
- `404 not_found` — comm_id doesn't exist in this club.
- `403 forbidden` — caller isn't on the club.

### 3.2 `POST /clubs/{club_id}/communications/{comm_id}/reply` — Reply button

```http
POST /clubs/5/communications/42/reply
Authorization: Bearer <admin+ JWT>
Content-Type: application/json

{ "body_html": "<p>Hi Jane, Tuesday works. See you then.</p>" }
```

Optional fields in the body:
```json
{
    "body_html": "<p>...</p>",
    "subject":   "Re: Your enquiry"
}
```

**Auth:** admin+ only (members can read threads but can't send on the club's behalf).

**Response:**
```json
201 {
    "status": "success",
    "data": {
        "communication_id":        99,
        "thread_id":               "<abc@torny.pro>",
        "parent_communication_id": 42,
        "recipient_email":         "jane@example.com",
        "recipient_user_id":       87,
        "message_id":              "<xyz@torny.pro>",
        "provider_message_id":     "0000-ses-internal-id"
    }
}
```

**Backend does automatically:**
- Resolves the recipient (`from_email` for inbound parents; `users.email` for outbound parents).
- Sets `In-Reply-To` + `References` headers on the outbound SES send so the recipient's client threads correctly.
- Inserts a new `member_communications` row with `thread_id` inherited from the parent + back-pointer `parent_communication_id`.

**Error codes:**
- `body_required` (400)
- `no_recipient` (422)
- `send_failed` (502)
- `forbidden` (403)
- `not_found` (404)

---

## 4. FE UX — Communications tab

### 4.1 Collapsed timeline (default state)

Render all `member_communications` rows in a scrolling list, newest first, same as today. Each row shows a one-liner:

- **Outbound email** (`channel='email'`): sender name + subject + sent_at.
- **Inbound email** (`channel='email_inbound'`): from_name/from_email + subject + received_at.
- **Note/call/sms**: render as today.

### 4.2 Expanded conversation view

User clicks an email row → the row expands inline (not a modal — stays in the timeline). The expand action:

1. Calls `GET /clubs/{id}/communications/{comm_id}/thread`.
2. Replaces the clicked row with the full conversation list — **newest at the top**, scrolling down reveals older messages in full (per the Paper 33b design + the user's "no collapsed messages" feedback).
3. Shows a **Reply** button at the bottom (admin+ only; hide for member-tier CRM users).
4. Shows a **Close** control to collapse back to the timeline view.

Component name: `CommunicationThreadView.vue`.

### 4.3 Reply composer

Click Reply → inline composer opens below the conversation:

- RichTextEditor from `@torny/content-blocks`.
- Send button → `POST .../reply`.
- On success: close the composer, append the new row to the conversation view, toast "Reply sent".
- On error: stay in the composer, surface the error.

**Don't optimistically render the reply.** Wait for the 201.

### 4.4 Cross-member threads

A thread may span multiple members. For now, render all messages in the thread regardless of which member's page you're viewing.

### 4.5 Rendering direction + styling

Per the Paper 33b design — ink border + soft shadow on the anchor (latest) message, hairline border on the rest. Avatar sand on outbound (Nev · ink pill), sand on inbound (accent-soft pill). `Matched` chip on inbound rows where `user_id` is set. `You` chip on outbound rows.

---

## 5. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"
CLUB=5

curl -s "$VENUE/clubs/$CLUB/communications/42/thread" -H "Authorization: Bearer $TOKEN" | jq
# → { data: { thread_id, anchor_id: 42, messages: [{direction, subject, ...}, ...] } }

curl -s -X POST "$VENUE/clubs/$CLUB/communications/42/reply" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"body_html":"<p>Testing threading from the API.</p>"}' | jq
# → 201 { data: { communication_id, thread_id, parent_communication_id: 42, ... } }
```

Also worth checking the receiving side: the real member's inbox should show the reply threaded under the original.

---

## 6. Pass criteria

- ✓ Clicking any email row opens the full conversation inline.
- ✓ Messages render chronologically with clear inbound/outbound distinction.
- ✓ Reply button sends successfully + the new message appears in the thread without a page refresh.
- ✓ Reply received by the member's email client is threaded under the original.
- ✓ Non-admin CRM users (member tier) can see threads but don't see the Reply button.
- ✓ Standalone messages (no thread_id OR thread_id resolves to only one row) still render cleanly.

---

## 7. Non-goals

- Forward button.
- Attachment surface.
- Re-threading orphan rows.
- Edit / delete sent replies.
- Rich-text UX details beyond the existing composer.

---

## 8. Backend context

- Every outbound email generates its own RFC 5322 Message-ID (`<uuid@torny.pro>`) and stores it as `message_id` + `thread_id` (new thread rooted on itself).
- Every inbound reply arrives with `In-Reply-To: <original-message-id>`. The inbox processor extracts it; the API resolves `in_reply_to → parent row via message_id` and inherits `parent.thread_id`.
- Thread lookup = single indexed `WHERE thread_id = ?`. No recursive CTE.
- The `direction` field is server-computed from `channel`.

---

## 9. Follow-up / nice-to-haves

- Unlinked inbound surface (user_id NULL from unknown senders).
- Mark as read / unread.
- Search inside threads.

---

## 10. Contact

Nev on Slack (`#torny-eng`). FE side is unblocked — all endpoints live.

---

## 11. FE status — shipped

Landed in:

- `packages/api-client/src/resources/communications.ts` — `getThread(clubId, commId)` + `replyToCommunication(clubId, commId, { body_html, subject? })`. Typed `ThreadMessage`, `ThreadResponse`, `ReplyResult`, `ReplyErrorCode`. Routed through `VENUE_BASE`.
- `apps/crm/src/components/CommunicationThreadView.vue` — new component, matches the Paper 33b design. Thread head (back nav, subject, `N messages · participants · INBOX` chip, star/archive/overflow). Message stack reverse-chronologically: anchor renders with ink border + soft shadow + `Matched` / `You` chip; the rest with hairline border, same body grammar. All messages fully expanded (per the earlier "no collapsed messages" feedback). Reply dock docked at the bottom with RichTextEditor from `content-blocks`, formatting toolbar, Send reply pill.
- `apps/crm/src/views/members/MemberDetailView.vue` — clicking any email row (outbound or inbound) now opens the thread view inline. A back-to-list affordance in the thread head returns to the timeline. The old EmailDetailModal is still reachable from the admin dashboard; member detail now uses the thread view instead.

The FE honours brief 101 §4.3 "don't optimistically render" — reply dock only appends the row after the 201 lands.

# Brief 112 — Venue booking notifications + real-time push to the CRM

**Scope:**
- API (Venue stack): new notification kinds for the venue-booking lifecycle (received / paid / declined / cancelled / refunded). Wire into the existing `fanoutCrmNotification` pipeline from brief 40 so they land in `/clubs/:cid/notifications`.
- API (SAM stack + edge): real-time push channel so the CRM can show a toast the instant a notification lands, instead of waiting for the 60s poll. Recommended: API Gateway WebSockets.
- CRM FE (`tornyglory/torny-crm-websites`): toast infrastructure wired to the notifications store + opt-in WebSocket client once the backend channel exists.

**Prereq:** brief 40 (CRM notifications pipeline) shipped. Brief 109 (public venue booking + Stripe checkout) shipped.

> **What triggered this brief:** a test booking confirmed via Stripe on 2026-11-21 — the admin never saw a notification in the CRM. Checked `/clubs/5/notifications` after the webhook fired; no `venue_booking_*` row. Separately: even when notification kinds that *do* emit (`application_received`, `enquiry_received`, `member_communication_inbound`) fire, the CRM only picks them up on the next `NotificationsDropdown` poll (60s), so admins miss the moment.

---

## 1. The gap

Two problems stacked on top of each other:

1. **Venue booking events don't emit notifications.** When `POST /public/clubs/:slug/venue-bookings` lands a new enquiry, or the Stripe webhook flips `payment_status = 'paid'` on a `venue-bookings/checkout` flow, nothing is pushed to the CRM notifications pipeline. Admins only discover bookings by eyeballing the Venue bookings inbox.
2. **Notifications aren't real-time.** Brief 40 fanouts drop into `crm_notifications`; the CRM reads the table on a 60s poll. Fine for low-urgency kinds (milestones), awful for the moment-of-booking "a paying renter is waiting on confirmation" feeling the Settings → Billing / Stripe flow trains admins to expect.

Phase A fixes (1); Phase B fixes (2).

---

## 2. Phase A — notification kinds for venue bookings

### 2.1 New `notifications.kind` values

| kind | Fires when | `destination_href` | Priority |
|---|---|---|---|
| `venue_booking_received` | Public enquiry-mode submit lands (no Stripe) | `/crm/venue-bookings/{booking_id}` | normal |
| `venue_booking_paid` | Stripe webhook flips `payment_status = 'paid'` on a booking | `/crm/venue-bookings/{booking_id}` | **high** |
| `venue_booking_declined` | Admin declines a booking (existing CRM action) | `/crm/venue-bookings/{booking_id}` | low |
| `venue_booking_cancelled` | Admin cancels a confirmed booking | `/crm/venue-bookings/{booking_id}` | low |
| `venue_booking_refunded` | Stripe refund webhook OR admin initiates a refund | `/crm/venue-bookings/{booking_id}` | low |

Target: `fanoutCrmNotification({ clubId, type: 'venue_booking_*', bookingId })`. Reuses the existing brief 40 pipeline; the CRM's `NotificationsStore` already handles unknown kinds gracefully (brief 100 + 101 wired that pattern).

### 2.2 Row shape (shared across kinds)

```json
{
    "notification_id": 4821,
    "club_id": 5,
    "kind": "venue_booking_paid",
    "title": "New venue booking — The clubhouse",
    "body": "Ruth Willis paid a $243 deposit for 18 Dec. Afternoon slot, 40 guests.",
    "priority": "high",
    "target": {
        "destination_href": "/crm/venue-bookings/812",
        "booking_id": 812,
        "booking_ref": "BK-2026-A60C38"
    },
    "unread": true,
    "created_at": "2026-11-21T01:12:08Z"
}
```

- `title` always carries the package name so admins can triage from the bell dropdown without clicking through.
- `body` is renter + money + slot + date — enough context to decide whether to action now or later.
- `target.destination_href` lands on the existing Venue bookings detail route (reuse brief-104's deep-link pattern).
- `target.booking_ref` is handy for the WebSocket toast surface (see §3) so the toast can show the same ref the admin will see on the detail page.

### 2.3 Firing rules

- **Enquiry-mode submit** → fires `venue_booking_received` immediately on `POST /venue-bookings` success. Even if Stripe isn't in the mix, the admin wants to know a request came in.
- **Stripe `checkout.session.completed`** → fires `venue_booking_paid` as part of the same webhook handler that flips `payment_status`. Idempotent — replays don't double-fire (guard on `payment_status === 'paid'` being set this call).
- **Admin lifecycle actions** — `declined` / `cancelled` fire from the existing PATCH handler. `refunded` from either the admin refund handler or the Stripe `charge.refunded` webhook, whichever moves first (idempotent on `payment_status === 'refunded'`).

### 2.4 Error / miss handling

- If the notification insert fails (rare — DB blip), log + continue. The booking is the source of truth; the notification is a convenience. Never 500 a Stripe webhook because the notification side-effect failed.
- If the booking row is deleted before an admin opens the notification, the deep link 404s on the detail route. Existing CRM behaviour handles this fine (empty state with a "go back" link).

---

## 3. Phase B — real-time push

### 3.1 Goal

When a `fanoutCrmNotification` row lands for a club, every open CRM tab for that club gets a push within ~1s, triggers a toast ("New venue booking — The clubhouse · 40 guests, 18 Dec"), and increments the unread badge on the bell. No 60s poll gap.

### 3.2 Recommended channel — API Gateway WebSockets

- Already native on AWS; same CloudFormation stack as the REST endpoints.
- Auth: connection handshake uses the admin's existing CRM JWT (query param + custom authorizer, or a `?token=` exchange). Server stores `{ connection_id, user_id, club_ids[] }` in a lightweight DynamoDB table.
- On `fanoutCrmNotification`, look up all connections for the recipient club, post to each via the `ApiGatewayManagementApi.postToConnection` call. Fire-and-forget — swallow 410 `GoneException` and prune the stored row.
- Disconnect handler nukes the DynamoDB row.

Message shape (one for every kind):

```json
{
    "type": "notification.new",
    "club_id": 5,
    "notification": { … full row from §2.2 … }
}
```

Kept loose on purpose so the FE can switch on `type` for future events (`booking.declined`, `enquiry.replied`, etc.) without a protocol version bump.

### 3.3 Alternatives considered (not recommended)

- **SSE from Lambda** — Lambda's 15min max + API Gateway REST not SSE-friendly make this a bad fit. Would need a long-lived connection on an ALB / Fargate service → heavier.
- **Cloudflare Durable Objects** — great for WebSockets but puts real-time state on a different stack from the write path (Lambda). Keeping both in AWS is easier to reason about.
- **Server-sent push via FCM / APNs** — overkill for in-app toasts; browser push permission prompts are UX-hostile for a workforce tool. Save for the future "notify oncall admin after hours" brief.

### 3.4 Rate + delivery guarantees

- At-most-once delivery. If a message is dropped (admin tab was reloading, connection closed mid-publish), the next poll covers it. The toast is "nice to have"; the notification row in `crm_notifications` is the source of truth.
- No ordering guarantee across kinds — the FE sorts by `created_at` locally on receive.
- Heartbeat every 30s to keep proxies from killing the connection; connection closed → FE auto-reconnects with exponential backoff.

---

## 4. FE scope

### 4.1 Phase A integration — tighten the poll, add the toast

- `NotificationsStore.fetchList(cid)` already debounced + cached. Change the poll interval from 60s → 20s.
- New `useToast()` emission on every `kind.startsWith('venue_booking_')` that arrives via the next poll AND isn't already in state. Short-circuits the "I won't see it until I click the bell" problem by at least a factor of 3.
- Toast grammar: eyebrow (`VENUE BOOKING · PAID`), title (notification.title), action (NuxtLink to `destination_href`). Dismiss on click or 10s auto-dismiss. Uses the existing `CrmToast` component.

### 4.2 Phase B integration — WebSocket client

- Thin wrapper (`packages/api-client/src/resources/notificationsRealtime.ts`) opening a WS connection against the API Gateway WebSocket URL on CRM boot, keyed by the current session token.
- On `type: 'notification.new'`, push the row into the notifications store + fire the toast the same way the polling path does. No duplicate — the store dedupes by `notification_id`.
- Fall back to the 20s poll when the WS can't open (bad network, proxy blocks WS, backend not shipped yet). Loud dev warning but silent degradation in prod.

### 4.3 Toast surface

- Single toast stack top-right (above the user menu). Max 3 visible; older toasts collapse to a "+ N more" row with a click-to-expand.
- Respects the user's reduced-motion preference. Dark + light themes use the existing CrmToast tokens.
- Clicking the toast navigates to `destination_href` and marks the notification read.

---

## 5. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # owner JWT
CLUB=5

# Phase A — new notification kinds
# 1. Submit a public enquiry-mode booking
curl -s -X POST "$VENUE/public/clubs/nae-nae-bowling-club/venue-bookings" \
    -H "Content-Type: application/json" \
    -d @venue-booking-payload.json
# → booking_id + booking_ref on success

# 2. Notification row lands within seconds
curl -s "$VENUE/clubs/$CLUB/notifications?limit=5" -H "Authorization: Bearer $TOKEN" \
    | jq '.data.notifications[0] | { kind, title, target }'
# → kind: "venue_booking_received", title: "New venue booking — The clubhouse", target.booking_id present

# 3. Simulate Stripe webhook (or run a real test payment) and refetch
curl -s "$VENUE/clubs/$CLUB/notifications?limit=5" -H "Authorization: Bearer $TOKEN" \
    | jq '.data.notifications[0] | { kind, priority }'
# → kind: "venue_booking_paid", priority: "high"

# Phase B — WebSocket push (after it ships)
# 1. wscat connects
wscat -c "wss://<api-gw-ws-id>.execute-api.ap-southeast-2.amazonaws.com/Prod?token=$TOKEN"
# → connected

# 2. Fire a test booking → the socket receives the notification.new message
# → { type: "notification.new", club_id: 5, notification: {…} }

# 3. CRM UI (live tab) toasts within ~1s of the webhook call.
```

---

## 6. Pass criteria

### Phase A
- ✓ Submit → `venue_booking_received` row appears in `/clubs/:cid/notifications` for the club owner + any admin on the recipient list.
- ✓ Stripe paid webhook → `venue_booking_paid` row appears, `priority: 'high'`, `destination_href` lands on the booking detail.
- ✓ Admin decline → `venue_booking_declined` row, `priority: 'low'`.
- ✓ Replay-safe — second webhook call for the same session doesn't double-row.

### Phase B
- ✓ Open CRM tab → WebSocket connects within 2s of auth hydrate.
- ✓ Fire a test booking → connected tabs receive the `notification.new` frame within 1s of the backend emit.
- ✓ Toast appears on receive; click lands on the detail.
- ✓ WS drops + reconnects on network blips with exponential backoff.
- ✓ When WS can't connect, the FE silently falls back to the 20s poll — no user-visible error.

### FE (both phases)
- ✓ `NotificationsStore` dedupes by `notification_id` across the WS and poll sources.
- ✓ Toast respects reduced-motion.
- ✓ Max 3 toasts visible; older collapse to a "+ N more" affordance.

---

## 7. Non-goals

- **Email + SMS fanout.** Already covered by the existing admin notification settings. This brief is the in-app push only.
- **Per-admin notification routing.** All admins on the club get the push. Brief 94's per-role filter already covers whether they can see the Venue bookings module; respect that on the server when deciding who to notify.
- **Push to non-admins.** Members on the club don't get venue-booking pushes. Follow-up brief if that ever makes sense.
- **Historical replay.** If an admin's WS was closed when a notification fired, they catch up on the next poll. No "give me everything I missed" push.
- **Mobile browser support for WebSocket at launch.** Desktop-first; the mobile CRM shell keeps polling until a future brief adds WS there too.
- **Offline queue.** No service-worker cache. If the admin is offline, they'll see the row on the next page load.

---

## 8. Phasing suggestion

- **Week 1 — Phase A ship:** notification kinds + fanout in the existing Lambda stack. FE picks them up on the next poll immediately. Toast grammar can go in on the FE side the same day — just listens for new venue-booking kinds in the store.
- **Week 2–3 — Phase B scaffolding:** API Gateway WebSocket + DynamoDB connection table. Deploy behind a feature flag so the FE can opt in gradually.
- **Week 4 — Phase B cut-over:** FE opens the WS on CRM boot. Poll stays as a fallback. No UI change the admin sees other than "notifications now appear instantly."

---

## 9. Contact

Nev on Slack (`#torny-eng`). Related briefs: 40 (CRM notifications pipeline — pattern to extend), 100 (member communication inbound — same fanout shape), 104 (notification deep-link destination_href), 109 (public venue booking + Stripe checkout — source of the new events).

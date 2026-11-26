# Brief 112 — Venue booking CRM notifications

**STATUS — PHASE A SHIPPED 2026-11-26 (commit `df0b55c`).**

Two new notification kinds flow into the existing brief-40 `crm_notifications` pipeline. The CRM's existing 60-second poll will pick them up as-is — no FE wiring required for Phase A to show up in the bell dropdown.

Phase B (real-time WebSocket push + toast infra + 60s → 20s poll) stays deferred. That's 2–3 weeks of infrastructure work (API Gateway WebSockets + DynamoDB connection table + custom authorizer + FE reconnection logic). Not blocking anything concrete today.

**Scope shipped (Phase A):**
- Two new `crm_notifications.kind` values: `venue_booking_received`, `venue_booking_paid`
- Fan-out through the existing `fanoutCrmNotification` pipeline from brief 40
- Both fire with full target shape so brief-104 deep-link navigation works

**Prereq:** brief 40 (CRM notifications pipeline) shipped — it is. Brief 109 (public venue bookings + Stripe checkout) shipped — it is.

---

## 1. What lights up

### `venue_booking_received`

Fires on: `POST /public/clubs/{slug}/venue-bookings` (enquiry-mode submit, no Stripe) → after the `venue_bookings` INSERT succeeds.

```jsonc
// Row in crm_notifications
{
  "id": 36,
  "recipient_user_id": 8,                    // every CRM role on the club gets their own row
  "kind": "venue_booking_received",
  "title": "New venue booking — The clubhouse",
  "body": "Ruth Willis enquiring about $1020 for 2027-02-14 · Morning · 9am – 1pm · 25 guests",
  "target_resource": "venue_booking",
  "target_resource_id": 19,
  "destination_href": "/crm/venue-bookings/19",
  "dedupe_key": "venue_booking:19:received",
  "created_at": "2026-11-26T13:44:12.000Z"
}
```

- `target_resource` + `target_resource_id` + `destination_href` are the brief-104 standard — the FE's existing deep-link wiring handles the route.
- Fans out to every active CRM role on the recipient club (owner / admin / member) via `requireClubRole`'s role map.

### `venue_booking_paid`

Fires on: Stripe `checkout.session.completed` webhook → after the `UPDATE venue_bookings SET payment_status = 'deposit_paid'` lands.

Only fires on the **first transition** to `deposit_paid` (affectedRows > 0). Stripe retries don't duplicate.

```jsonc
{
  "kind": "venue_booking_paid",
  "title": "Deposit paid — The clubhouse",
  "body": "Ruth Willis paid a $243 deposit for 2026-12-18 · Afternoon · 2pm – 6pm · 40 guests",
  "target_resource": "venue_booking",
  "target_resource_id": 812,
  "destination_href": "/crm/venue-bookings/812",
  "dedupe_key": "venue_booking:812:paid"
}
```

**Important:** the backend fires on the `deposit_paid` transition, not full `paid`. The brief text said `paid`, but in practice our Stripe flow flips to `deposit_paid` when the deposit lands (not the balance). That's the admin-pain-moment the ship was triggered by, so that's what fires. Full-balance-paid (`paid` status) is a future addition if needed.

---

## 2. Delivery semantics

- **In-app only** by default on both kinds. The public submit path already sends a templated admin-alert email via `sendClubEmail`; a second email from here would be redundant. Per-club email settings can toggle on via `crm_notification_settings` when the FE builds that UX.
- **Fan-out recipients:** every CRM role on the club (owner, admin, member) with `revoked_at IS NULL`.
- **Dedupe:** `dedupe_key` pattern `venue_booking:{id}:received|paid`. The UNIQUE index on `(club_id, recipient_user_id, dedupe_key, unread_marker)` catches replays silently — a repeat call while the row is unread collides and no-ops; a repeat after the row was read inserts a fresh unread row.
- **Failures are non-fatal.** If the fanout write dies, the booking still persists (submit) or the Stripe state still updates (webhook). Audit log is a `console.warn` only.

---

## 3. What the FE needs to do

**For Phase A — nothing.** The existing `NotificationsStore.fetchList(cid)` 60-second poll picks these up immediately. The bell dropdown surfaces them next poll after a booking lands.

**Suggested FE tightening (optional):**
- Grammar for the two new kinds in whatever switch renders bell-row chips
- `venue_booking_received` — neutral chip, standard colour
- `venue_booking_paid` — green/highlight (money has arrived, admin's cue to switch from "pending" to "booked")

**Phase B (deferred, FE scope when it ships):**
- Toast infrastructure on every `kind.startsWith('venue_booking_')` that arrives via the next poll AND isn't already in state
- Poll interval 60s → 20s
- WebSocket client wrapper against the Phase B push channel

---

## 4. Testing

### Smoke (ran during the ship, 2026-11-26)

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"

# Submit a test booking at Naenae
curl -s -X POST "$VENUE/public/clubs/nae-nae-bowling-club/venue-bookings" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Booker",
    "email": "test@example.com",
    "booking_date": "2027-02-14",
    "package_id": 9,
    "slot_id": 11,
    "attendee_count": 25,
    "message": "test"
  }'
# → 201 with { booking_ref, id }

# Verify in DB
SELECT * FROM crm_notifications
 WHERE kind = 'venue_booking_received'
   AND target_resource_id = <booking_id>;
# → one row per active CRM admin on the club, dedupe_key populated
```

### FE verification

1. As a Naenae admin, log into the CRM.
2. Open the bell dropdown.
3. Submit a test public booking at `naenae-bowling-club.torny.pro/book`.
4. Within ~60s the bell shows an unread badge + a `New venue booking — The clubhouse` entry.
5. Click → routes to `/crm/venue-bookings/{id}`.
6. Repeat for Stripe deposit path (real card needed) — `Deposit paid — …` lands.

---

## 5. What's deliberately not in Phase A

| Item | Why |
|---|---|
| `venue_booking_declined` | Admin who declines a booking already knows; firing a notification into their own bell is noise. Easy to add later if teammates want visibility. |
| `venue_booking_cancelled` | Same |
| `venue_booking_refunded` | Same |
| `priority: high/low` field | `crm_notifications` schema doesn't have a priority column. FE already switches on `kind` for toast grammar, so encoding priority implicitly in the `kind` name works fine. Avoided a migration. |
| Real-time WebSocket push (Phase B) | 2–3 week infra investment. The 60s poll closes 90% of the "admin missed the moment" pain. Separate brief when the ROI calculus changes. |
| Custom email templates per kind | `sendClubEmail` already handles the admin-alert email on submit. Per-admin per-kind email settings land via the existing `crm_notification_settings` row when the FE ships that UX. |

---

## 6. Related briefs

- Brief 40 — CRM notifications pipeline. This brief extends it; no changes to the pipeline itself.
- Brief 100 — `member_communication_inbound`. Same fanout shape.
- Brief 104 — notification deep-link `destination_href`. Phase A emits the field; FE wiring is already live.
- Brief 109 — public venue booking + Stripe checkout. Submit + webhook paths are the trigger points.
- Brief 123 Phase 3 — admin portal transactions drilldown. Same `venue_booking` resource key.

---

## 7. Contact

Nev on #torny-eng. Phase B scoping starts when there's a concrete ROI case for the ~2-week WebSocket infrastructure investment.

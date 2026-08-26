# CRM Notifications

**Feature:** the bell-icon dropdown in the CRM top bar. Shows a live feed of things that need the caller's attention — new applications, enquiries, RSVP thresholds, team-selection confirmations, publish results, payment batches, member milestones. Powers the red-dot unread badge on the bell.

**Status:** frontend built and mocked (see `apps/crm/src/components/NotificationsDropdown.vue`). Awaiting backend — this brief is the contract.

**Related briefs:**
- brief 38 (applications) — `application` notifications reference an application_id.
- brief 39 (scoped CRM roles) — each notification carries a `required_permission` field so the frontend can hide notifications the caller can't act on.
- brief 29 (roster) — `member_milestone` notifications reference a user_id.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

All endpoints are admin+ (any CRM role that isn't `player`). The backend filters the returned list to notifications the caller has permission to see (see §5).

---

## 1. The endpoints

| Method | Path | Auth |
|---|---|---|
| `GET`    | `/clubs/{club_id}/notifications` | CRM role |
| `GET`    | `/clubs/{club_id}/notifications/unread-count` | CRM role |
| `POST`   | `/clubs/{club_id}/notifications/{notification_id}/read` | CRM role |
| `POST`   | `/clubs/{club_id}/notifications/read-all` | CRM role |
| `PATCH`  | `/me/notification-settings` | any authed user |
| `GET`    | `/me/notification-settings` | any authed user |

---

## 2. The seven notification kinds

Each notification carries a `kind` — a stable string the frontend switches on for the icon + tone. Add kinds via code deploys, same JS-constant pattern as brief 22 / 37.

| kind | Fires when | Example title | Example body |
|---|---|---|---|
| `application` | A new membership application is submitted (brief 38 POST) | `Aroha Ngata applied to join` | `Playing member · referred by Marcus Tuilagi` |
| `enquiry` | A contact-form message lands (future brief) | `Jamila Otto sent an enquiry` | `"Hi team, my partner and I are keen to try lawn bowls…"` (first ~90 chars) |
| `rsvp` | An event's RSVP going-count hits a configured threshold | `Twilight roll-up hit 40 RSVPs` | `Threshold you set: 30. Cap is 60.` |
| `team` | A team-selection round moves to `needs_confirming` | `Round 8 team selection needs confirming` | `Pennant Div 3 · Petone A · Saturday 12:30pm` |
| `publish` | A published site rebuild completes (success or fail) | `Membership page published` | `Cache purged across 3 URLs. 2 blocks changed.` |
| `payment` | A payment batch (dues collection / renewal reminder) completes | `Dues collected: 6 members` | `$840.00 processed via Stripe.` |
| `member_milestone` | A member hits a games / years / trophies threshold | `Denise Peters hit 500 games` | `Achievement auto-suggested for honour board.` |

Kinds map 1:1 to the `Kind` union in `NotificationsDropdown.vue` line 15-22 — don't rename without frontend coordination.

---

## 3. The notification row

The list endpoint returns rows in this shape (matches the frontend `Notif` interface):

```jsonc
{
  "id": 84172,
  "club_id": 5,
  "kind": "application",
  "title": "Aroha Ngata applied to join",
  "body": "Playing member · referred by Marcus Tuilagi",
  "created_at": "2026-08-26T22:14:03Z",
  "unread": true,
  "target": {
    "resource": "application",         // 'application' | 'enquiry' | 'event' | 'team_round' | 'page' | 'payment_batch' | 'member'
    "resource_id": 4177,               // integer PK on that resource
    "destination_href": "/crm/applications?highlight=4177"
  },
  "primary_action": {                  // optional — omit when no one-tap action makes sense
    "label": "Approve",
    "action": "approve_application",   // 'approve_application' | 'reply_enquiry' | 'confirm_round' | 'view' | 'add_to_honour_board'
    "href": "/crm/applications?highlight=4177&action=approve"
  },
  "required_permission": "applications:review",   // from brief 39. Rows the caller lacks are filtered server-side, not just hidden.
  "actor": {                           // optional — who caused this
    "user_id": null,                   // null when the actor is a public visitor (join-form submitter)
    "display_name": "Aroha Ngata",
    "avatar_url": null
  },
  "dedupe_key": "application:4177:created"   // §7 — used to prevent duplicate rows
}
```

**Field notes:**
- `title` is at most 80 chars. `body` at most 140. Both are plain text (no HTML). Longer copy belongs in the target page.
- `created_at` is ISO 8601 UTC. Frontend renders relative time (`12m`, `2h`, `Yesterday`) client-side — don't send pre-formatted strings.
- `destination_href` and `primary_action.href` are relative paths inside the CRM (`/crm/…`). Backend just passes them through — frontend `router.push()` handles them.
- `primary_action.action` is a machine key. The frontend uses `href` for navigation; `action` exists so we can pattern-match if we ever add server-side action tracking.
- `required_permission` matches brief 39's permission strings (`applications:review`, `enquiries:respond`, etc.). If the caller's role lacks it, the row is omitted server-side. When brief 39 hasn't shipped yet, use the legacy owner+/admin+ check and return `required_permission: null`.

---

## 4. `GET /clubs/{club_id}/notifications`

The main list endpoint.

**Query params:**
- `tab` (default `all`) — `all` or `unread`. `unread` returns only rows where `unread=true`.
- `limit` (default 25, max 100). Frontend loads ~25 for the dropdown.
- `before` (optional) — ISO 8601 UTC. Return rows with `created_at < before` for infinite scroll.
- `kinds` (optional) — comma-separated allowlist (`application,enquiry`). Omit for all kinds. Used by future filter chips.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "notifications": [ /* array of Notif objects — §3 */ ],
    "unread_count": 3,             // caller's unread across ALL kinds, ignoring tab + kinds filter
    "has_more": true               // true when at least one more row exists past `before`
  }
}
```

`unread_count` returns the full unread total even when the caller is looking at `tab=unread` — the frontend needs it for the red bell dot regardless of the current filter.

**Ordering:** `created_at DESC`. Row order is stable — a mark-read never resorts.

**Empty state:** `notifications: []`, `unread_count: 0`, `has_more: false`.

**Caching:** none. The dropdown is expected to reflect within a few seconds of a fire. See §8 for the pub/sub note.

---

## 5. `GET /clubs/{club_id}/notifications/unread-count`

Lightweight endpoint for the bell badge. Called on shell mount + every 60s while the CRM is focused, and after any dropdown mutation.

**200 response:**
```jsonc
{ "status": "success", "data": { "unread_count": 3 } }
```

Uses the same permission-filter as the list — a Selector viewing a club with 40 pending applications doesn't see those in their unread count.

**Rate-limit:** 1 request per 5 seconds per (user, club). 429 with `Retry-After` on abuse — the frontend polls at 60s but a bouncing dropdown could hammer it. Backend returns 429 with `retry_after_ms` in the body.

---

## 6. Mark-read endpoints

### 6.1 `POST /clubs/{club_id}/notifications/{notification_id}/read`

Marks a single row read. Idempotent — repeat calls are 200 + no-op.

**Body:** none.

**200 response:**
```jsonc
{ "status": "success", "data": { "unread_count": 2 } }
```

Returning the fresh `unread_count` saves a follow-up request for the badge.

**Errors:**
- `404 not_found` — id doesn't belong to this club.
- `403 forbidden` — caller isn't a CRM role on this club.

### 6.2 `POST /clubs/{club_id}/notifications/read-all`

Marks every row the caller can see as read. Cheap batched write.

**Body (optional):**
```jsonc
{ "kinds": ["application", "enquiry"] }   // optional — restrict to specific kinds
```

**200 response:**
```jsonc
{ "status": "success", "data": { "marked": 3, "unread_count": 0 } }
```

---

## 7. Dedupe

Every notification carries a `dedupe_key` — a stable string that identifies the underlying event. If the backend tries to insert a row with a `dedupe_key` that already exists **and is unread**, it updates the existing row (bumps `created_at`, re-marks unread if needed) instead of inserting a duplicate.

Recommended shapes:
- `application:{id}:created` — one row per submission.
- `application:{id}:reminded` — a follow-up "still pending after 3 days" nudge.
- `enquiry:{id}:created`
- `rsvp:{event_id}:threshold_{n}` — one per threshold crossing.
- `team_round:{round_id}:needs_confirming`
- `page:{page_id}:published_{deploy_id}` — every deploy is unique.
- `payment_batch:{batch_id}:completed`
- `member_milestone:{user_id}:{metric}:{value}` — e.g. `member_milestone:812:games_played:500`.

Read rows are never dedupe-collided into — a second "Aroha applied" after the first was marked read produces a new row (and probably indicates a data issue, but that's a separate problem).

---

## 8. When rows appear

**Fire on the write path** where practical:
- brief 38 POST `/public/clubs/:slug/applications` inserts one `application` row on success.
- Contact form POST inserts one `enquiry` row.
- RSVP write inserts an `rsvp` row when the going-count crosses a threshold (see §11 config).
- Team-selection state transition to `needs_confirming` inserts a `team` row.
- Publish worker inserts a `publish` row when a deploy finishes (whether success or fail — body copy differs).
- Payment worker inserts a `payment` row when a batch settles.
- Nightly cron for `member_milestone` — checks games / years / trophies thresholds against a `member_milestone_seen` set to avoid re-inserting.

The frontend does **not** poll the list endpoint on a timer. It polls `unread-count` every 60s (cheap) and re-opens the dropdown to refetch the list. If we want realtime we'd add a WebSocket or Server-Sent-Events channel — out of scope for v1.

---

## 9. Notification settings

Each user opts kinds in or out. Defaults are on for everything except `payment` (which typically only Treasurers care about).

### 9.1 `GET /me/notification-settings`

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "per_kind": {
      "application":       { "in_app": true,  "email": true },
      "enquiry":           { "in_app": true,  "email": true },
      "rsvp":              { "in_app": true,  "email": false },
      "team":              { "in_app": true,  "email": false },
      "publish":           { "in_app": true,  "email": false },
      "payment":           { "in_app": false, "email": false },
      "member_milestone":  { "in_app": true,  "email": false }
    },
    "email_digest": "off"    // 'off' | 'daily' | 'weekly'
  }
}
```

`in_app` off = never insert into that user's notifications table. `email` off = never fire the transactional email even if the row is inserted.

### 9.2 `PATCH /me/notification-settings`

Body is a partial patch — any missing fields keep their current value.

```jsonc
{
  "per_kind": { "payment": { "in_app": true } },
  "email_digest": "weekly"
}
```

Response echoes the full updated settings (same shape as GET).

**Errors:** `400 bad_kind` if an unknown kind slug is sent. `400 bad_digest` for invalid `email_digest`.

---

## 10. Per-user vs per-club scoping

Notifications are addressed to (user, club) pairs. A user with memberships in three clubs sees three separate notification streams, one per club — the CRM shell scopes by `club.current.id`.

**Backend table (illustrative):**

```
notifications
├── id
├── club_id
├── recipient_user_id
├── kind
├── title, body
├── target_resource, target_resource_id
├── destination_href, primary_action_json
├── required_permission
├── actor_user_id, actor_display_name
├── dedupe_key            (unique index on (club_id, recipient_user_id, dedupe_key) where read_at IS NULL)
├── read_at (nullable)
└── created_at
```

**Recipient fan-out:** when the write path fires, the backend inserts one row per member of the club whose role has the required permission AND whose `notification_settings.per_kind[kind].in_app === true`. For a club with 3 owner+ admins subscribed to `application`, one submission = 3 rows. Sounds heavy — it's not, we're talking dozens per club per day maximum.

---

## 11. RSVP thresholds — config

`rsvp` notifications need per-event configuration. Extend the events table with:

```
events.rsvp_notify_thresholds JSON   -- e.g. [30, 50] means fire at 30 AND at 50
events.rsvp_notify_seen        JSON   -- e.g. [30] means the 30 threshold has already fired
```

The RSVP write path checks the current going-count against `rsvp_notify_thresholds` minus `rsvp_notify_seen`, fires the notification for each unseen crossed value, then appends to `rsvp_notify_seen`. Default `rsvp_notify_thresholds` on new events = `[]` (no notifications).

Owner sets thresholds when creating/editing an event — that's a small addition to the events CRUD form. Not part of this brief; call it out in the events editor when we build the follow-up.

---

## 12. Error shapes

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_kinds` | The `kinds` query param includes an unknown value |
| 400 | `bad_limit` | limit < 1 or > 100 |
| 400 | `bad_before` | before isn't valid ISO 8601 |
| 400 | `bad_kind` | PATCH settings with an unknown kind key |
| 400 | `bad_digest` | PATCH settings with an invalid `email_digest` value |
| 401 | | No JWT |
| 403 | `forbidden` | Caller has no CRM role for this club |
| 404 | `not_found` | notification_id doesn't belong to this club |
| 429 | `rate_limited` | Unread-count polled too fast — `retry_after_ms` in body |

---

## 13. Frontend integration plan

- **`packages/api-client/src/resources/notifications.ts`** — new resource:
  - `list(clubId, { tab, before, limit })`
  - `unreadCount(clubId)`
  - `markRead(clubId, id)` → returns fresh `unread_count`
  - `markAllRead(clubId, { kinds? })`
  - `getSettings()` / `updateSettings(patch)` on `/me/notification-settings`
- **`useNotificationsStore`** — Pinia store holding the current page of rows + the running unread count. Polls `unreadCount` every 60s while the tab is visible (using the Page Visibility API to pause when hidden).
- **`NotificationsDropdown.vue`** — swap the mocked ref for the store, keep the visual design intact. Row `openRow` calls `markRead` before navigating.
- **`CrmShell.vue`** — replace the current unread bell badge (whatever it reads today) with `notificationsStore.unreadCount`.
- **Settings screen** — new "Notifications" section under Team access / Security. Table of kinds × in-app × email checkboxes + a digest radio group. Uses the `/me/notification-settings` endpoints.

---

## 14. TS types

```ts
type NotificationKind =
  | 'application' | 'enquiry' | 'rsvp' | 'team'
  | 'publish' | 'payment' | 'member_milestone'

interface NotificationTarget {
  resource: 'application' | 'enquiry' | 'event' | 'team_round' | 'page' | 'payment_batch' | 'member'
  resource_id: number
  destination_href: string
}

interface NotificationAction {
  label: string
  action: 'approve_application' | 'reply_enquiry' | 'confirm_round' | 'view' | 'add_to_honour_board'
  href: string
}

interface NotificationActor {
  user_id: number | null
  display_name: string
  avatar_url: string | null
}

interface Notification {
  id: number
  club_id: number
  kind: NotificationKind
  title: string
  body: string
  created_at: string
  unread: boolean
  target: NotificationTarget
  primary_action: NotificationAction | null
  required_permission: string | null
  actor: NotificationActor | null
  dedupe_key: string
}

interface ListNotificationsParams {
  tab?: 'all' | 'unread'
  limit?: number
  before?: string
  kinds?: NotificationKind[]
}

interface ListNotificationsResponse {
  notifications: Notification[]
  unread_count: number
  has_more: boolean
}
```

---

## 15. Verification (please attach outputs)

- ✓ Submit an application via brief 38 POST → an `application` row appears for every admin+ user of that club within 2 seconds
- ✓ Same submitter submits twice in five minutes → second POST doesn't create a second unread `application` row (dedupe by `application:{id}:created`)
- ✓ Mark that row read → subsequent `unread-count` returns N-1
- ✓ Second submitter → new `application` row (dedupe key differs by id)
- ✓ Selector role calls the list — sees zero `application` rows (filtered by `required_permission: applications:review`)
- ✓ Membership officer calls the list — sees applications, no `payment` rows (their role lacks `payments:read`)
- ✓ RSVP hits configured threshold → `rsvp` row appears with correct `body` copy
- ✓ Same event's RSVP re-crosses the same threshold after going down and up → does NOT re-fire (seen list persists)
- ✓ `POST /read-all` with `{"kinds":["application"]}` marks only those, other kinds stay unread
- ✓ `PATCH /me/notification-settings` with `per_kind.payment.in_app = false` — subsequent payment writes skip that user's row
- ✓ Unread-count polled 3× in 3 seconds → 3rd returns 429 with `retry_after_ms`

---

## 16. Non-goals

- Real-time push (WebSocket / SSE / web push). v1 polls unread-count at 60s.
- Native mobile push. Separate brief once the mobile app has its own notifications table.
- Notification filtering / muting rules (`don't notify me about Alex's RSVPs`). Kind-level opt-out only.
- History beyond 90 days. Old read rows should be pruned by a nightly job — the dropdown isn't an audit log.
- Per-club digest overrides. `email_digest` is user-level, applies across all clubs.

---

## 17. Contact

Same as prior briefs. If a new notification-emitting event lands (e.g. `member_removed` when someone revokes their own membership), add a new kind here and coordinate the frontend switch cases before shipping.

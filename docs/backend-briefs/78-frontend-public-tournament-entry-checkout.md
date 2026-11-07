# Public tournament-entry checkout — captain pays entry at submit

**Feature:** paid tournaments charge the entry fee at submit time via Stripe-hosted Checkout. The rule-set is driven by a single admin flag (`open_to_visitors`) — not the fee. Open tournaments always take payment via Stripe; private tournaments are members-only and settle offline.

**Status:** backend partially live on TornyVenueStack as of 2026-11-08 — the Checkout Session + webhook plumbing from brief 72 already handles tournament entries end-to-end. What's left on the backend is the rule simplification in §3 (drop the free-is-members-only check; add the open-requires-fee validator) and the new public member-search endpoint in §5. FE wiring is the second half of this brief.

**Supersedes:** the prior version of this brief which keyed the rules off `entry_fee_cents`. That rule-set has been dropped — admin's "open vs private" flag is the single source of truth now.

**Related briefs:**
- `frontend-public-venue-checkout-brief.md` — same Stripe Checkout architecture, read first.
- `docs/backend-briefs/72-stripe-connect-venue-hire-deposit.md` — Stripe Connect foundation.

---

## TL;DR — the model

| | **Open tournament** (`open_to_visitors=true`) | **Private tournament** (`open_to_visitors=false`) |
|---|---|---|
| **Fee** | Required > $0. Backend rejects create/update if $0. | Admin's choice — $0 or any amount. |
| **Roster** | Free-text per slot (name + email). Anyone eligible. | Pick from the host club's member list. |
| **Payment** | Stripe Checkout, always. Torny takes `application_fee_amount`. | Offline — admin collects on the day. |
| **Entry endpoint** | `POST tbqlfxlc0e.../tournaments/{tid}/enter/checkout` (Venue stack) | `POST byi59x19m4.../tournaments/{tid}/enter` (CRM stack) |

The FE branches on `open_to_visitors` only. No fee-based branching anywhere.

### Why this shape

- **Torny gets paid every time a stranger plays.** Open tournaments are the growth loop; they must settle through Stripe so Torny's platform fee lands.
- **Clubs keep their members' comps private.** The private path doesn't involve Stripe or Torny — it's a pure fixture tool for the club.
- **Admins don't have to think about fee + visibility interactions.** One toggle picks everything.

---

## Base URLs

| Purpose | Base URL | Stack |
|---|---|---|
| Private entry (members only, offline pay) | `https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod` | TornyCrmStack |
| **Open entry (Stripe Checkout)** | `https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod` | TornyVenueStack |
| **Public member search** (new, §5) | `https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod` | TornyCrmStack |

Public = no auth. Captain contact details come from the body for guests.

---

## 1. `POST /tournaments/{tournament_id}/enter/checkout` — open tournaments

Backend already live. Called by the FE only when `tournament.open_to_visitors=true`.

### Request

```jsonc
{
  "team_name": "The Rolling Jacks",
  "captain_contact": {
    "name":  "Grace Whittaker",
    "email": "grace@example.co.nz",
    "phone": "+64 21 123 4567"
  },
  "roster": [
    { "name": "Grace Whittaker", "email": "grace@example.co.nz", "position": "skip" },
    { "name": "Jim Reynolds",    "email": "jim@example.co.nz",   "position": "second" },
    { "name": "Mei Kawhai",      "email": "mei@example.co.nz",   "position": "lead" }
  ]
}
```

- `captain_contact.email` — required, standard email format, ≤ 255 chars.
- `team_name` — optional, ≤ 120 chars.
- `roster` — required. Shape + size validated against `format` (singles → 1, pairs → 2, triples → 3, fours → 4). Each row needs `name`, `email`, `position`.

### 200 — paid path (normal case)

```jsonc
{
  "status": "success",
  "data": {
    "entry": {
      "id":                412,
      "entry_number":      7,
      "team_name":         "The Rolling Jacks",
      "status":            "pending",
      "waitlist_position": null,
      "captain": { "user_id": null, "name": "Grace Whittaker", "email": "...", "phone": "...", "club_id": null },
      "paid_cents": null,
      "paid_at":    null,
      "roster":     [ ... ],
      "created_at": "2026-11-08T22:14:00.000Z"
    },
    "entry_fee_cents":     2500,
    "platform_fee_cents":  100,
    "club_receives_cents": 2400,
    "currency":            "nzd",
    "checkout_url":        "https://checkout.stripe.com/c/pay/cs_test_…",
    "checkout_session_id": "cs_test_…",
    "next_step":           "pay"
  }
}
```

- `platform_fee_cents` is a flat amount (default $1/entry) from `club_tournament_settings.platform_fee_cents`. Not a percentage. Clamped so it can't exceed the entry fee.
- `entry.status` is `'pending'` here. Webhook flips to `'confirmed'` + populates `paid_cents` / `paid_at` once the renter pays.
- Currency from `tournaments.currency`, default `nzd`.

### 200 — waitlist path (no payment)

Cap full + waitlist enabled → entry lands as `waitlisted`, no Stripe charge:

```jsonc
{
  "status": "success",
  "data": {
    "entry": { "id": 413, "entry_number": 32, "status": "waitlisted", "waitlist_position": 4, ... },
    "checkout_url":      null,
    "next_step":         "wait_confirmation",
    "waitlist_position": 4
  }
}
```

FE detects `checkout_url === null` → render waitlist confirmation, no redirect.

### Server flow

1. Validate tournament + timing + roster shape.
2. Reject 400 `no_fee_to_charge` if `entry_fee_cents <= 0` — shouldn't happen for open tournaments after §3 ships; defensive.
3. Reject 400 `wrong_endpoint_for_private_tournament` if `open_to_visitors=false` — caller should have hit `/enter` on the CRM base.
4. Reject 409 `club_not_payment_ready` if host club `stripe_account_status !== 'ready'`.
5. Validate captain + duplicate-entry check.
6. Cap/waitlist decision — `pending` entries **don't** count against cap (same model as venue bookings).
7. Insert entry with `status='pending'` (or `'waitlisted'`) + `platform_fee_cents_snapshot`.
8. If `pending`: create Stripe Checkout Session on connected account, `application_fee_amount = platform_fee_cents`, success/cancel URL per §6.
9. Store `stripe_checkout_session_id` on the row. Return response above.

---

## 2. Error responses

### 400

| code | when |
|---|---|
| `bad_body` | request body isn't valid JSON |
| `bad_tournament_id` | path param isn't a positive integer |
| `bad_email` | captain email missing or invalid format |
| `entries_closed` | tournament status isn't `published`, or now is outside `entries_open_at`..`entries_close_at` |
| `no_fee_to_charge` | `entry_fee_cents <= 0` — defensive; shouldn't happen post-§3 |
| `wrong_endpoint_for_private_tournament` | caller hit `/enter/checkout` for an `open_to_visitors=false` tournament. **NEW.** Hint: use `/enter` on the CRM base. |
| `bad_roster_*` / `bad_position` / `too_young_for_bcnz` etc. | roster shape or eligibility |
| `duplicate_entry` | roster `user_id` already on another entry |
| `waitlist_full` | cap full and waitlist cap also full |
| `tournament_entries_paused` | `club_tournament_settings.is_active = 0` |

### 403 `members_only` — private tournaments only (`/enter` on CRM base)

Defensive backstop. The FE member picker prevents this organically, but if someone POSTs a non-member email directly:

```jsonc
HTTP 403
{
  "status": "error",
  "code": "members_only",
  "message": "This tournament is for club members only. Please remove non-members from the roster.",
  "data": {
    "non_member_emails": ["alice@example.com", "bob@example.com"]
  }
}
```

### 409 `club_not_payment_ready` — open tournaments only (`/enter/checkout`)

```jsonc
HTTP 409
{
  "status": "error",
  "code": "club_not_payment_ready",
  "message": "Naenae Bowling Club isn't accepting online payments yet — please contact them directly to enter.",
  "data": {
    "club_contact": { "name": "...", "email": "...", "phone": "..." }
  }
}
```

### 502 — Stripe failed

`stripe_checkout_create_failed` — Stripe rejected the session create. Safe to surface a generic retry toast.

---

## 3. Admin rule — open requires a fee `[NEW backend work]`

Supersedes the old free-is-members-only rule.

**Validator on `POST/PATCH /clubs/{cid}/tournaments`:**

- If the payload sets or leaves `open_to_visitors=true`, `entry_fee_cents` must be > 0.
- If `open_to_visitors=false`, `entry_fee_cents` can be anything ≥ 0.

**New error (400):**

```jsonc
{
  "status": "error",
  "code": "open_requires_fee",
  "message": "Open tournaments must have an entry fee. Private tournaments can be free."
}
```

FE admin form mirrors this — the fee input is locked to a $1 minimum when the "Open to visitors" toggle is on.

### Why we're dropping free-is-members-only

Previously the brief said "any tournament with `entry_fee_cents <= 0` is members-only regardless of `open_to_visitors`." That's gone. Rationale:

- The admin UX surfaces one knob (Open vs Private), not two. Keying off fee is mental overhead.
- **Torny gets paid every time a stranger plays.** The old rule allowed free + open, which bypassed Torny entirely. Not acceptable.
- The private path has nothing to do with payment anymore — it's purely "can outsiders enter?". Free private tournaments are a normal case (club championships, social comps).

---

## 4. Private tournaments — member picker UX `[NEW FE work]`

For `open_to_visitors=false`, the roster UI is a member chooser, not a free-text form. Captain types a name/handle, FE queries `/public/clubs/{slug}/members?search=...` (§5), captain picks a member per slot.

**Why a picker, not free-text:**
- Private = members-only, so the pool is finite and known.
- Prevents captains from typo-ing non-member emails and hitting the `members_only` 403.
- Matches the admin mental model: "pick who's playing from the list of players I know."

Backend hardening: the `/enter` handler still validates every submitted roster email against `club_members` and 403s on mismatch. The picker is UX, not security.

---

## 5. `GET /public/clubs/{slug}/members` — public member search `[NEW backend work]`

Powers the private-tournament roster picker. Public, no auth. Name-only payload — no email, no phone, no DOB. Designed so the roster picker can show matches to anyone browsing the public club site without leaking member contact details.

### Request

```
GET /public/clubs/{slug}/members?search=mei&limit=10
```

- `search` — required. Case-insensitive substring match against `first_name`, `last_name`, and `handle`. Minimum 2 chars (400 `bad_search` otherwise).
- `limit` — optional, default 10, max 25.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "members": [
      { "user_id": 3421, "first_name": "Mei",     "last_name": "Kawhai",  "handle": "meik",  "initials": "MK" },
      { "user_id": 1182, "first_name": "Emeline", "last_name": "Pratchet","handle": "emep",  "initials": "EP" }
    ]
  }
}
```

### Rules

- Only `club_members` rows where `status='active'` and `revoked_at IS NULL` are returned.
- Returned `user_id` is used by the FE when it calls `/enter` on the CRM base — the server can trust the user is a member because we just returned them.
- No pagination beyond `limit` — this is a typeahead, not a browse.

### Errors

| HTTP | code | when |
|---|---|---|
| 400 | `bad_search` | missing / < 2 chars |
| 400 | `bad_limit` | > 25 |
| 404 | `not_found` | slug doesn't resolve |

### Non-goals

- No search by email. If a captain only knows an email, they should ask that person their name.
- No fuzzy / phonetic matching. Substring is enough for v1.
- No "members available for this format" filter. If a member is on another entry, the standard `duplicate_entry` validation catches it at submit time.

---

## 6. Stripe-hosted Checkout — captain experience

Unchanged from the prior version — reproduced for completeness.

After `window.location.href = data.checkout_url`:

1. Stripe renders its hosted Checkout page.
2. Captain enters card (or Apple Pay / Google Pay).
3. 3DS handled inline.
4. On successful payment, Stripe redirects to the club's own subdomain:
   ```
   https://nae-nae-bowling-club.torny.co/tournaments/24/entry-complete?entry_id=412&result=success
   ```
5. On cancel:
   ```
   https://nae-nae-bowling-club.torny.co/tournaments/24/entry-complete?entry_id=412&result=cancelled
   ```

Base URL is `https://{club.subdomain}.torny.co` — same pattern as the venue-hire `/book/complete`.

### `/tournaments/{tid}/entry-complete` landing page

- `?result=success` → "Entry received" message. Static. Webhook flips to `confirmed` + `paid` server-side within a couple of seconds.
- `?result=cancelled` → "Payment cancelled — your entry wasn't recorded" + retry CTA.

Neither path needs an API call. Entry rows left at `status='pending'` on cancel get swept by the backlog cleanup job (24h).

---

## 7. Lifecycle (open tournaments)

```
Captain fills entry form on {subdomain}.torny.co/tournaments/{slug}/enter
       │
       │  POST /tournaments/{tid}/enter/checkout  (Venue API, open tournaments only)
       ▼
┌──────────────────────────────────────────────────┐
│ Backend: validate, insert entry (status='pending'),│
│ create Stripe Checkout Session on connected      │
│ account, return URL.                             │
└──────────────────────────────────────────────────┘
       │
       │  200 { checkout_url }
       ▼
FE does window.location.href = checkout_url
       │
       ▼
Stripe-hosted Checkout page (card / Apple Pay / Google Pay / 3DS)
       │
       ├── Captain pays ──► Stripe redirects to /tournaments/{tid}/entry-complete?result=success
       │                           │
       │                           │  Stripe fires checkout.session.completed
       │                           ▼
       │                   Webhook handler (routes by metadata.payment_type='tournament_entry'):
       │                   - Idempotency ledger insert
       │                   - Flip entry: status='confirmed', paid_cents, paid_at, payment_reference
       │
       └── Captain cancels ──► /tournaments/{tid}/entry-complete?result=cancelled
                                   │
                                   ▼
                           Entry stays at pending; FE shows cancelled state
```

Private tournaments: single POST to `/enter` on CRM base. No Stripe. Entry lands as `status='confirmed'` immediately (or `waitlisted` if cap full), no `paid_cents`. Admin logs payment manually on the day.

---

## 8. FE contract — api-client

```ts
// packages/api-client/src/resources/tournaments.ts (extend existing)

export interface EnterTournamentInput {
  team_name?: string | null
  captain_contact?: {
    email: string
    phone?: string | null
  }
  roster: Array<{
    position: string
    user_id?: number | null   // populated by the member picker for private tournaments
    name?: string | null
    email?: string | null
    bcnz_number?: string | null
  }>
}

// Private — existing endpoint, CRM base URL
export interface EnterTournamentResult {
  entry: TournamentEntry
  next_step: 'pay' | 'done' | 'wait_confirmation'
  waitlist_position: number | null
}

// Open (paid) — new call, Venue base URL
export interface EnterTournamentCheckoutResult {
  entry: TournamentEntry
  entry_fee_cents:     number
  platform_fee_cents:  number
  club_receives_cents: number
  currency:            string
  checkout_url:        string | null    // null when waitlisted
  checkout_session_id: string | null
  next_step:           'pay' | 'wait_confirmation'
  waitlist_position?:  number
}

export const tournaments = {
  enter(tid: number, input: EnterTournamentInput): Promise<EnterTournamentResult>,
  enterWithCheckout(tid: number, input: EnterTournamentInput): Promise<EnterTournamentCheckoutResult>,
}
```

```ts
// packages/api-client/src/resources/members.ts (extend existing)

export interface PublicMemberMatch {
  user_id: number
  first_name: string
  last_name: string
  handle: string | null
  initials: string
}

export async function publicSearch(
  slug: string,
  search: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<PublicMemberMatch[]>
```

---

## 9. FE surface that lights up

### Public tournament entry form (`pages/tournaments/[slug]/enter.vue`)

Forks on `tournament.open_to_visitors`:

**Open tournaments:**
- Current free-text roster UI (name + email per slot) stays.
- Primary CTA → "Pay entry fee · $X" calling `enterWithCheckout()`.
- On success → `window.location.href = checkout_url`.
- On `club_not_payment_ready` 409 → surface `club_contact` fallback.
- On waitlist response → show "you're #N on the waitlist" state.

**Private tournaments:**
- Replace the free-text roster UI with a `MemberPicker` component per slot. Typeahead against `members.publicSearch(slug, q)`. Captain picks a member → slot stores `{ user_id, name }`.
- Primary CTA → "Submit entry" calling `enter()`.
- On success → render offline-confirmation screen ("Entry received — [club] will contact you about paying on the day").
- On `members_only` 403 → defensive; surface `non_member_emails` inline against the offending slots. Shouldn't happen if the picker is working.

### Admin tournament form (`apps/crm/src/views/tournaments/TournamentFormView.vue`)

- When "Open to visitors" toggle is ON, the entry-fee input is locked to a $1 minimum. Inline hint: "Open tournaments require a fee — Torny collects a small service fee from each paid entry."
- When OFF, the fee is unrestricted ($0 allowed).
- Backend mirrors the rule — client-side is UX polish, not security.

### `/tournaments/[slug]/entry-complete` landing page

Hosted on each club subdomain. Reads `entry_id` + `result` from the query string. Static — no API call.

---

## 10. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Open tournament → Stripe Checkout.
curl -X POST -H "Content-Type: application/json" \
  "$VENUE/tournaments/24/enter/checkout" -d '{"team_name":"Rolling Jacks","captain_contact":{"name":"Grace","email":"grace@example.co.nz","phone":"+64211111111"},"roster":[{"name":"Grace","email":"grace@example.co.nz","position":"skip"},{"name":"Jim","email":"jim@example.co.nz","position":"second"},{"name":"Mei","email":"mei@example.co.nz","position":"lead"}]}'
# → 200 { data: { entry, checkout_url, ... } }

# 2. Pay with 4242 4242 4242 4242 → redirects to {subdomain}.torny.co/tournaments/24/entry-complete?result=success.
curl -H "Authorization: Bearer $JWT" "$CRM/clubs/5/tournaments/24/entries"
# → entry.status='confirmed', paid_cents = entry_fee_cents

# 3. Open tournament with $0 fee → 400 at tournament create.
curl -X POST -H "Authorization: Bearer $JWT" "$CRM/clubs/5/tournaments" \
  -d '{"title":"Test","open_to_visitors":true,"entry_fee_cents":0,...}'
# → 400 { code: 'open_requires_fee' }

# 4. Open tournament against unconnected club → 409 with contact block.
curl -X POST "$VENUE/tournaments/42/enter/checkout" -d '{...}'
# → 409 { code: 'club_not_payment_ready', data: { club_contact: {...} } }

# 5. Private tournament entry with a non-member email → 403.
curl -X POST "$CRM/tournaments/19/enter" -d '{"roster":[{"email":"stranger@example.com",...}]}'
# → 403 { code: 'members_only', data: { non_member_emails: [...] } }

# 6. Private tournament via /enter with all members → 201.
curl -X POST "$CRM/tournaments/19/enter" -d '{...}'
# → 201 { entry: { status: 'confirmed' }, next_step: 'done' }

# 7. Public member search.
curl "$CRM/public/clubs/nae-nae-bowling-club/members?search=mei&limit=5"
# → 200 { members: [{ user_id, first_name, last_name, handle, initials }, ...] }

# 8. Wrong endpoint — private tournament hitting /enter/checkout → 400.
curl -X POST "$VENUE/tournaments/19/enter/checkout" -d '{...}'
# → 400 { code: 'wrong_endpoint_for_private_tournament' }
```

Pass criteria:
- ✓ Open tournament POST to `/enter/checkout` returns `checkout_url`; paying flips entry to `confirmed` + `paid` within ~2s.
- ✓ `application_fee_amount` lands on the platform account; the rest lands on the connected account.
- ✓ Open tournament with `entry_fee_cents <= 0` can't be saved — 400 `open_requires_fee`.
- ✓ Unconnected club 409s cleanly with `club_contact`.
- ✓ Private tournament `/enter` with a non-member roster 403s with `non_member_emails` list.
- ✓ Private tournament with all members submits as `confirmed`.
- ✓ Public member search returns the matching rows, name-only.
- ✓ Replay of `checkout.session.completed` is a no-op (idempotency ledger).

---

## 11. Non-goals (v1)

- **No Stripe Elements / embedded form.** Hosted Checkout only.
- **No multi-currency.** Whatever `tournaments.currency` says (defaults to `nzd`).
- **No slot hold during Checkout.** Two captains racing to the last slot: both get checkout URLs, both may pay; admin refunds one via existing refund endpoint. Hold-lock is a follow-up.
- **No waitlist → payment flow.** When admin promotes a waitlisted entry, the captain isn't automatically prompted to pay. Separate feature.
- **No public "get entry by id" endpoint.** The landing page trusts Stripe's `result=success` redirect.
- **No partial refunds or refund-by-captain.** Admin-only via existing `POST /clubs/{cid}/tournament-entries/{eid}/refund`.
- **No team-roster edit after payment.** Captain gets what they submitted. Admin can PATCH.
- **No email search in `/public/clubs/{slug}/members`.** Name/handle only.

---

## 12. Contact

Ping Felicity when §3 (open_requires_fee) + §5 (public member search) are deployed and the webhook has been smoke-tested end-to-end.

**Smoke:** Pick tournament 24 (`club_id=5` Naenae, `entry_fee_cents=2500`, `open_to_visitors=true` — Stripe-ready in prod). Submit an open entry, pay with 4242, confirm the CRM shows `status='confirmed'` + populated `paid_cents` within a couple of seconds.

**Heads-up:** same Naenae/Richmond shared `stripe_account_id` test artifact — flagged in brief 77. Not a blocker for testing.

# Public tournament-entry checkout — captain pays entry at submit

**Feature:** paid tournaments charge the entry fee at submit time via Stripe-hosted Checkout — same architecture as the venue-hire deposit flow. Entry fee direct-charges the host club's connected Stripe account; Torny takes a flat platform fee (default $1/entry) as `application_fee_amount`. Free tournaments stay on the existing `/enter` endpoint — no payment, entry lands as `confirmed` immediately.

**Status:** backend live on TornyVenueStack as of 2026-11-08. The only pieces left are the FE wiring the public entry form + building the `/tournaments/{tid}/entry-complete` landing page (per-club subdomain). No feature flag — the endpoint 409s cleanly for clubs that haven't onboarded to Stripe, so it can ship everywhere and falls back to "contact the club" messaging for unconnected clubs.

**Related briefs:**
- `frontend-public-venue-checkout-brief.md` — same architecture, read first. The redirect pattern, the `/book/complete` landing page shape, and the `club_not_payment_ready` 409 handling all apply here with the obvious name swaps.
- `frontend-stripe-venue-bookings-brief.md` — Stripe Connect foundation (onboarding, status, webhook) reference.
- `docs/backend-briefs/72-stripe-connect-venue-hire-deposit.md` — internal brief 72 context.

---

## TL;DR

1. **Two endpoints, two different stacks** — FE must route by whether the tournament is paid:
   - Free (`entry_fee_cents == 0`) → `POST byi59x19m4.../tournaments/{tid}/enter` (CRM API, existing).
   - Paid → `POST tbqlfxlc0e.../tournaments/{tid}/enter/checkout` (**Venue API, new — different base URL**).
2. **Free = members only.** If `entry_fee_cents == 0`, the tournament is club-members-only. Captain's email AND every roster member's email must belong to a current member of the host club. Backend enforces this with a 403 `members_only` error that lists the offending emails — the FE should surface it and let the user fix the roster. Overrides `open_to_visitors` entirely (free entry is a members benefit, not an open invite).
3. **Paid flow mirrors venue-hire checkout.** Captain submits → backend creates entry as `status='pending'` + a Stripe Checkout Session on the host club's connected account → returns `checkout_url` → FE does `window.location.href = data.checkout_url`.
4. **Platform fee is a flat cents amount** (default $1/entry) from `club_tournament_settings.platform_fee_cents`. Not a percentage. Clamped so it can't exceed the entry fee.
5. **Waitlist carve-out** — if the entry would land on the waitlist (cap full + waitlist allowed), **no Stripe charge**. Response has `checkout_url: null` and `next_step: 'wait_confirmation'`. Captain is on the waitlist; admin can promote + prompt payment later via a separate flow.
6. **Build `/tournaments/{tid}/entry-complete`** on each club's public subdomain (same template as `/book/complete`). Reads `entry_id` + `result` from the query string.

---

## Base URLs

| Purpose | Base URL | Stack |
|---|---|---|
| Free + offline-pay entry | `https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod` | TornyCrmStack |
| **Paid Stripe checkout** | `https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod` | TornyVenueStack |

The different base URLs for `/enter` vs `/enter/checkout` are a CFN-cap workaround on the CRM stack (which is at its 500-resource limit). The FE already deals with multiple base URLs — treat these two like the other split bases.

Both routes are **public** (no auth). Captain contact details come from the body for guests.

---

## 1. `POST /tournaments/{tournament_id}/enter/checkout`

Only for paid tournaments. Free tournaments 400 here with `no_fee_to_charge` — call `/enter` on the CRM base instead.

### Request

Exactly the same body shape as the existing `/enter` endpoint — no new fields.

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

Rules:
- `captain_contact.email` — required (standard email format, ≤ 255 chars). For authed callers this is derived from the user; guests must supply it.
- `captain_contact.name` + `phone` — optional for guests (default name is "Guest").
- `team_name` — optional, ≤ 120 chars.
- `roster` — required. Array of participants; shape + size validated against the tournament's `format` (singles → 1, pairs → 2, triples → 3, fours → 4). Each entry needs `name`, `email`, `position` (where position comes from the tournament's format — e.g. for triples: `lead` / `second` / `skip`).

### 200 response — paid path (normal case)

```jsonc
{
  "status": "success",
  "data": {
    "entry": {
      "id":               412,
      "entry_number":     7,
      "team_name":        "The Rolling Jacks",
      "status":           "pending",
      "waitlist_position": null,
      "captain": {
        "user_id": null,
        "name":    "Grace Whittaker",
        "email":   "grace@example.co.nz",
        "phone":   "+64 21 123 4567",
        "club_id": null
      },
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

- **`checkout_url`** is what the FE redirects to.
- **`platform_fee_cents`** is a flat amount (default $1/entry), not a percentage. `club_receives_cents = entry_fee_cents - platform_fee_cents` (pre-Stripe processing fees).
- `entry.status` is `'pending'` on this path. The webhook flips it to `'confirmed'` + populates `paid_cents` / `paid_at` once the renter pays.
- `currency` is whatever the tournament is configured with (`t.currency`, default `nzd`).

### 200 response — waitlist path (no payment)

When the tournament is at cap but waitlist-enabled, the entry still lands but we don't charge:

```jsonc
{
  "status": "success",
  "data": {
    "entry": {
      "id":               413,
      "entry_number":     32,
      "status":           "waitlisted",
      "waitlist_position": 4,
      ...
    },
    "checkout_url":      null,
    "next_step":         "wait_confirmation",
    "waitlist_position": 4
  }
}
```

FE should detect `checkout_url === null` and render a waitlist confirmation instead of redirecting. Captain knows they're #4 on the waitlist; admin will prompt them to pay separately if a spot opens.

### Server flow (for your mental model)

1. Validate tournament + timing gates (same rules as `/enter`).
2. Reject with 400 `no_fee_to_charge` if `entry_fee_cents <= 0`.
3. Reject with 409 `club_not_payment_ready` if host club has `stripe_account_status !== 'ready'`.
4. Validate roster + captain + visitor eligibility + duplicate-entry check (all same as `/enter`).
5. Cap/waitlist decision — `pending` entries **don't count against cap** (same model as venue bookings — no slot-hold during Checkout).
6. Insert entry with `status='pending'` (or `'waitlisted'`) + `platform_fee_cents_snapshot`.
7. Auto-roster the captain as a visitor at the host club (best-effort, non-fatal).
8. If `pending`: create Stripe Checkout Session on connected account (direct charge) with `application_fee_amount = platform_fee_cents`.
9. Store `stripe_checkout_session_id` on the entry.
10. Return the structured response above.

---

## 2. Error responses

### 400 — validation / config

| code | when |
|---|---|
| `bad_body` | request body isn't valid JSON |
| `bad_tournament_id` | path param isn't a positive integer |
| `bad_email` | captain email missing or invalid format |
| `entries_closed` | tournament status isn't `published`, or now is outside `entries_open_at`..`entries_close_at` |
| `no_fee_to_charge` | `entry_fee_cents <= 0` — call `/enter` on the CRM base instead |
| `bad_roster_*` / `bad_position` / `too_young_for_bcnz` etc. | roster shape or eligibility mismatch (same codes as `/enter`) |
| `visitor_not_allowed` | tournament `open_to_visitors=false` and captain isn't a member of the host club |
| `duplicate_entry` | one of the roster `user_id`s is already on another entry for this tournament |
| `waitlist_full` | cap full and waitlist cap also full |
| `tournament_entries_paused` | `club_tournament_settings.is_active = 0` |

### 404 — not found

| code | when |
|---|---|
| `not_found` | `tournament_id` doesn't resolve, or host club row is missing |

### 403 `members_only` — for free tournaments only

Returned by the `/enter` endpoint (CRM API) when any email in the submit payload isn't a current member of the host club. Response body carries the offending emails so the FE can surface them inline against the roster UI.

```jsonc
{
  "status": "error",
  "code": "members_only",
  "message": "This tournament is free — entries are limited to current club members.",
  "data": {
    "non_member_emails": ["alice@example.com", "bob@example.com"]
  }
}
```

Note: this is a `/enter` error, not a `/enter/checkout` error — paid tournaments don't apply this rule.

### 409 `club_not_payment_ready` — the critical one

Returned when the host club's `stripe_account_status` isn't `'ready'`. Response body carries the club's contact details so the FE can render a renter-friendly fallback.

```jsonc
{
  "status": "error",
  "code": "club_not_payment_ready",
  "message": "Naenae Bowling Club isn't accepting online payments yet — please contact them directly to enter.",
  "data": {
    "club_contact": {
      "name":  "Naenae Bowling Club",
      "email": "bookings@naenae.co.nz",
      "phone": "+64 4 567 8910"
    }
  }
}
```

Either of `club_contact.email` / `club_contact.phone` may be `null` — render whichever is present.

### 502 — Stripe failed

| code | when |
|---|---|
| `stripe_checkout_create_failed` | Stripe rejected the session create. Body carries Stripe's message. Safe to show the captain a generic "something went wrong, please try again" toast. |

### 500 — generic

Retryable with the same payload.

---

## 3. Free tournaments = members only

Backend rule (enforced in `submit-tournament-entry/index.js` on the `/enter` path):

- If `entry_fee_cents <= 0`:
  - Captain's `email` **must** match a non-revoked `club_members` row on the host club (joined via `users.email`).
  - Every entry in the `roster` array must also carry an `email` that matches a non-revoked club member.
  - This holds **regardless of `open_to_visitors`**. Free is a members benefit, not an open invite.
- If any email in the submit payload isn't a current member, the server returns:

```jsonc
HTTP 403
{
  "status": "error",
  "code": "members_only",
  "message": "This tournament is free — entries are limited to current club members.",
  "data": {
    "non_member_emails": ["alice@example.com", "bob@example.com"]
  }
}
```

The FE should surface the `non_member_emails` list so the captain can either remove those entries or ask them to join the club first. A generic "roster has non-members" toast without the list wastes time.

### FE roster picker — recommended UX

For **free tournaments**, the roster UI should **not** be a free-text "type an email" form. Instead:

- Render a **member-search chooser** per roster slot. Captain types a name or email, FE filters a list of club members, captain picks one.
- Member list source: the simplest v1 is for the FE to fetch the club's members list once (via an existing endpoint) and search client-side. If no suitable public endpoint exists yet and the captain is signed in, use `GET /clubs/{id}/members` with their JWT (committee-or-above). For a public picker on `{subdomain}.torny.co`, we'd need a new endpoint — flag it if you want it.
- Fall back to free-text + validation if the picker isn't ready for v1: let the captain type an email, submit, display the `members_only` error list inline against the offending roster entries.

For **paid tournaments**, keep the existing free-text roster UI (name + email + optional `dob` / `bcnz_id`). Anyone can be on a paid tournament roster; the server will still run the standard validation but won't do the member-only check.

### No public member-search endpoint today

If the FE wants a members-only search for the roster picker on the public club site, it needs a new public endpoint (something like `GET /public/clubs/{slug}/members?search=...` returning name-only, no email). That isn't shipped — say the word if you want me to build it. Short-term workaround: the picker only works for signed-in captains; guests use the free-text fallback and see the `members_only` error if they try to game it.

---

## 4. Which endpoint to call? (free vs paid)

Decision logic on the FE, keyed off the tournament's config returned by `GET /public/tournaments/{club_slug}/{tournament_slug}` (or whatever endpoint feeds the entry form):

```ts
async function enterTournament(tournament, payload) {
  const isPaid = Number(tournament.entry_fee_cents) > 0
  const base = isPaid
    ? 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'  // Venue stack
    : 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'  // CRM stack
  const path = isPaid
    ? `/tournaments/${tournament.id}/enter/checkout`
    : `/tournaments/${tournament.id}/enter`

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) throw { status: res.status, ...json }

  if (isPaid && json.data.checkout_url) {
    window.location.href = json.data.checkout_url
  } else if (isPaid && json.data.checkout_url === null) {
    showWaitlistConfirmation(json.data)  // waitlisted path
  } else {
    showFreeEntryConfirmation(json.data)  // /enter normal path
  }
}
```

(Alternative: the FE could always call `/enter/checkout` and handle the 400 `no_fee_to_charge` by falling back to `/enter`. Simpler to read but one extra round-trip for free tournaments. Up to you.)

---

## 5. Stripe-hosted Checkout — captain experience

After `window.location.href = data.checkout_url`:

1. Stripe renders its hosted Checkout page.
2. Captain enters card (or Apple Pay / Google Pay).
3. 3DS handled inline.
4. On successful payment, Stripe redirects to the **club's own subdomain**:
   ```
   https://nae-nae-bowling-club.torny.co/tournaments/24/entry-complete?entry_id=412&result=success
   ```
5. On cancel:
   ```
   https://nae-nae-bowling-club.torny.co/tournaments/24/entry-complete?entry_id=412&result=cancelled
   ```

Base URL is `https://{club.subdomain}.torny.co` — same pattern as the venue-hire `/book/complete` landing (see `frontend-public-venue-checkout-brief.md` §3 for why).

### The `/tournaments/{tid}/entry-complete` landing page

Lives on each club's public site. Handles both outcomes:

**`?result=success`:**
- Parse `entry_id` from the query string.
- Show "Entry received — you're in" state immediately. The webhook flips the entry to `confirmed` + `paid` within a couple of seconds; email receipt from Stripe lands in parallel.
- No API call needed for v1. Static success message with the tournament name + "see you on the day" copy is fine.

**`?result=cancelled`:**
- Show "Payment cancelled — your entry wasn't recorded" state.
- CTA to go back and try again.
- The entry row is left in the DB at `status='pending'`, `paid_cents=NULL`. It doesn't take a cap slot. Backlog item: sweep stale `pending` entries older than 24h.

Neither path needs to hit any protected API. Fully static OK.

---

## 6. Lifecycle — where state transitions happen

```
Captain fills entry form on {subdomain}.torny.co/tournaments/{slug}
       │
       │  POST /tournaments/{tid}/enter/checkout  (Venue API)
       ▼
┌─────────────────────────────────────────────┐
│ Backend: validate, insert entry (pending,  │
│ paid_cents=NULL), create Stripe Checkout    │
│ Session on connected account, return URL.   │
└─────────────────────────────────────────────┘
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
       │                   Our webhook handler (routes by metadata.payment_type='tournament_entry'):
       │                   - Inserts stripe_events row (dedupe)
       │                   - Flips entry: status='confirmed',
       │                     paid_cents, paid_at populated,
       │                     payment_reference = payment_intent_id
       │
       └── Captain cancels ──► /tournaments/{tid}/entry-complete?result=cancelled
                                   │
                                   ▼
                           Entry stays at status='pending',
                           FE shows the cancelled state
```

Key invariant: **the FE never writes the entry's paid state.** The webhook is the source of truth. The `/entry-complete?result=success` redirect fires immediately after the captain clicks Pay, but the webhook can arrive a second or two later — if the landing page tries to read entry state via an API, it may briefly see `pending`. Treat `result=success` as authoritative on the FE.

---

## 7. FE contract — api-client

```ts
// packages/api-client/src/resources/tournaments.ts (extend existing)

export interface TournamentEntryInput {
  team_name?: string
  captain_contact: {
    name?:  string
    email:  string
    phone?: string
  }
  roster: Array<{
    name: string
    email: string
    position: string            // 'lead' | 'second' | 'third' | 'skip' | 'singles' depending on format
    user_id?: number            // optional — if captain knows the Torny user id
    dob?: string                // 'YYYY-MM-DD', required when tournament has min_age / max_age
    bcnz_id?: string            // required when tournament.requires_bcnz = true
  }>
}

// Free + offline-pay — existing endpoint, CRM base URL
export interface TournamentEntryResult {
  entry: TournamentEntryRow
  next_step: 'pay' | 'done' | 'wait_confirmation'
  waitlist_position: number | null
}

// Paid — new endpoint, Venue base URL
export interface TournamentEntryCheckoutResult {
  entry: TournamentEntryRow
  entry_fee_cents:     number
  platform_fee_cents:  number
  club_receives_cents: number
  currency:            'nzd' | string
  checkout_url:        string | null    // null when waitlisted
  checkout_session_id: string | null
  next_step:           'pay' | 'wait_confirmation'
  waitlist_position?:  number
}

export interface ClubNotPaymentReadyError {
  code: 'club_not_payment_ready'
  message: string
  data: {
    club_contact: {
      name:  string
      email: string | null
      phone: string | null
    }
  }
}

export const tournaments = {
  enter(tid: number, input: TournamentEntryInput): Promise<TournamentEntryResult>,
  enterWithCheckout(tid: number, input: TournamentEntryInput): Promise<TournamentEntryCheckoutResult>,
}
```

---

## 8. FE surface that lights up

### Public tournament entry form

- Primary CTA label flips based on fee + Stripe-ready state:
  - Free tournament → "Submit entry"
  - Paid tournament, club ready → "Pay entry fee & book your spot"
  - Paid tournament, club not ready → disable the CTA, show "Entries by contact" with the club's email/phone (or fall back to `/enter` to log a pending entry)
- Before posting, show an itemised preview: entry fee, platform fee (optional — admin discretion whether to surface it), total due.
- Button handler per §3.
- Handle the waitlist return cleanly — same form, different success state.

### `/tournaments/{tid}/entry-complete` landing page

Same shape as `/book/complete` on the club subdomain:
- `?result=success` → "Entry received" message + tournament name + contact-day info.
- `?result=cancelled` → "Payment cancelled, try again" with a link back to the entry form.
- Static, no API call needed.

### Admin CRM

No FE work needed. The existing `/clubs/{id}/tournaments/{tid}/entries` list already shows entries. New paid entries land at `status='pending'` and flip to `'confirmed'` + populated `paid_cents` once the captain pays. If admin wants to see what's "awaiting payment", filter the entries list by `status='pending'` — that filter already exists.

---

## 9. Verification — curl

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Paid tournament, Stripe-ready club. Returns a checkout_url.
curl -X POST -H "Content-Type: application/json" \
  "$VENUE/tournaments/24/enter/checkout" \
  -d '{"team_name":"Rolling Jacks","captain_contact":{"name":"Grace","email":"grace@example.co.nz","phone":"+64211111111"},"roster":[{"name":"Grace","email":"grace@example.co.nz","position":"skip"},{"name":"Jim","email":"jim@example.co.nz","position":"second"},{"name":"Mei","email":"mei@example.co.nz","position":"lead"}]}'
# → 200 { data: { entry, checkout_url, ... } }

# 2. Open checkout_url in a browser, pay with Stripe test card 4242 4242 4242 4242.
#    Redirects to https://<subdomain>.torny.co/tournaments/24/entry-complete?entry_id=…&result=success.

# 3. Verify the webhook flipped the entry.
curl -H "Authorization: Bearer $JWT" "$CRM/clubs/5/tournaments/24/entries"
# → entry shows status='confirmed', paid_cents = entry_fee_cents, paid_at populated.

# 4. Free tournament → 400 no_fee_to_charge. Use /enter instead.
curl -X POST -H "Content-Type: application/json" \
  "$VENUE/tournaments/19/enter/checkout" -d '{…}'
# → 400 { code: 'no_fee_to_charge' }

# 5. Unconnected club → 409 with contact block.
curl -X POST -H "Content-Type: application/json" \
  "$VENUE/tournaments/42/enter/checkout" -d '{…}'
# → 409 { code: 'club_not_payment_ready', data: { club_contact: {…} } }

# 6. Cap full + waitlist enabled → entry lands as waitlisted, no checkout_url.
curl -X POST -H "Content-Type: application/json" \
  "$VENUE/tournaments/24/enter/checkout" -d '{…}'
# → 200 { data: { entry: { status: 'waitlisted', waitlist_position: 4 }, checkout_url: null, next_step: 'wait_confirmation' } }

# 7. Free tournament via /enter — existing CRM endpoint still works.
curl -X POST -H "Content-Type: application/json" \
  "$CRM/tournaments/19/enter" -d '{…}'
# → 201 { entry: { status: 'confirmed' }, next_step: 'done' }
```

Pass criteria:
- ✓ Paid tournament returns `checkout_url`; paying via Stripe flips the entry to `confirmed` + `paid` within ~2s.
- ✓ `application_fee_amount` lands on the platform; the rest lands on the connected account.
- ✓ Unconnected clubs 409 with a usable `club_contact` block.
- ✓ Waitlisted entries land with `checkout_url: null` and no charge fires.
- ✓ Free tournament via `/enter` lands as `confirmed` with `next_step: 'done'` (unchanged behaviour).
- ✓ Replay of `checkout.session.completed` doesn't double-flip state (idempotency ledger).

---

## 10. Non-goals (v1)

- **No Stripe Elements / embedded form.** Stripe-hosted Checkout only.
- **No multi-currency.** Whatever `tournaments.currency` says (defaults to `nzd`).
- **No slot hold during Checkout.** Two captains racing to the last slot: both get checkout URLs, both might pay; admin picks one and refunds the other via the existing `tournament-entry-refund` endpoint. Hold-lock is a follow-up.
- **No waitlist promotion → payment flow.** When admin promotes a waitlisted entry, the captain isn't automatically prompted to pay. That's a separate feature (needs a "pay this entry" link emailed out). Admin can also just manually chase them for now.
- **No public "get entry by id" endpoint.** The `/entry-complete` landing page is static and trusts the Stripe `result=success` redirect. If we want live state, we'd add `GET /public/tournament-entries/{id}` returning a trimmed row. Say the word if needed.
- **No partial refunds or refund-by-captain flows.** Refunds are admin-only via `POST /clubs/{cid}/tournament-entries/{eid}/refund` (existing).
- **No team-roster edit after payment.** Captain gets what they submitted. Admin can PATCH via `/clubs/{cid}/tournaments/{tid}/entries/{eid}` if needed.

---

## 11. Contact

Ping Felicity when the public entry form routing + `/tournaments/{tid}/entry-complete` landing page are on staging. Smoke: submit an entry against tournament 24 (`club_id=5` Naenae, `entry_fee_cents=2500`, `payment_method='online'` — Stripe-ready in prod), pay with test card `4242 4242 4242 4242`, confirm the CRM entries list shows the entry at `status='confirmed'` + populated `paid_cents` within a couple of seconds.

Heads up: same Naenae/Richmond shared `stripe_account_id` test artifact flagged in the venue-checkout brief — not an issue for testing but worth separating before either club goes live.

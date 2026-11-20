# Brief 109 — Public venue booking page: wire up live data

> **Numbering note:** backend sent this as "Brief 107" but 107 is already
> `docs/backend-briefs/107-drop-your-bowls-from-variant-and-join-form.md`.
> Saved here as **109** (next free number after `108-pay-on-join-stripe-checkout.md`).
> Content is verbatim from the backend-side brief.

**Scope:**
- FE (`tornyglory/torny-crm-websites`, `apps/club-sites`): the public Venue Hire page (`/venue-hire/book?space=<slug>`). Replace the current hardcoded slot list + badges with live data from `venue_packages` + `venue_availability`.

**Prereq:** none. Backend is already live.

> **Backend status (2026-11-20):** both read endpoints verified against prod. All four open questions from §7 have shipped — see the "Shipped answers" callouts below and the updated response payloads. The screenshot on Naenae's `?space=green-bbq` page shows the Clubhouse slots at Clubhouse prices with hardcoded "MOST BOOKED" / "BAR STAFF INCL." / "SAVE 15%" badges — that's FE sample content, not data from the DB.

What's new since the first drop:
- `slots[].badge` — optional owner-defined marketing badge (max 40 char).
- `settings.min_lead_hours` + availability's `lead_blocked_until` — server-enforced minimum notice window. Naenae = 48h.
- Availability's `taken[]` now includes package-level time overlap: book the Afternoon on Dec 20 and the Full Day also goes grey.
- `addons[].applies_to_slot_ids` — optional `number[]` scope. `null` = applies to every slot (existing behaviour).

---

## 1. The bug

Looking at the screenshot of `localhost:3001/venue-hire/book?space=green-bbq`:

- **Wrong package's slots.** URL says `space=green-bbq` but the four slot cards show $720 / $720 / $900 / $2,340 — those are **The Clubhouse** (slug `the-clubhouse`) prices. Green + BBQ's real slots are $220 / $220 / $400.
- **Hardcoded badges.** "MOST BOOKED", "BAR STAFF INCL.", "SAVE 15%" aren't in any `venue_slots.sub` column — the seed stores plain target-market copy ("Corporate half-day workshops…"). FE is overlaying bespoke badges.
- **Calendar availability is cosmetic.** Every December date shows "FREE" even though the DB has two confirmed bookings on Dec 17 NZST (slot 12 = Afternoon). May be correct if "FREE" means "at least one slot free," but the cell isn't surfacing the fact that the Afternoon slot is taken.

---

## 2. Endpoints to call

Base URL (production):

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Both endpoints are public — no `Authorization` header, no CORS auth shenanigans.

### 2.1 `GET /public/clubs/{slug}/venue-packages`

**Slug note (historical — see brief 110):** this endpoint keys on `clubs_data.slug` (e.g. `nae-nae-bowling-club`), **not** `subdomain` (`naenae-bowling-club`). The /clubs/resolve handler fix in brief 110 (2026-11-21) made `data.slug` return `clubs_data.slug`, so modern FE code can just pass `data.slug` through. Note that the sibling `variant` and `custom-facets` endpoints on the same Venue stack still key on **subdomain**, not `clubs_data.slug` — brief 110's addendum tracks aligning them.

Response (truncated to one package):

```json
{
    "status": "success",
    "data": {
        "packages": [
            {
                "id": 9,
                "slug": "the-clubhouse",
                "name": "The clubhouse",
                "sub": "Modern timber-lined main room · 65–80 seated / 140 standing · bar access & indoor/outdoor greens.",
                "description": "The Clubhouse is Naenae Bowling Club's nine-year-old function space…",
                "hero_image_url": null,
                "hero_image_alt": null,
                "bond_cents": 30000,
                "bond_label": "Security bond (refundable)",
                "display_order": 0,
                "slots": [
                    {
                        "id": 11,
                        "label": "Morning · 9am – 1pm",
                        "sub": "Corporate half-day workshops, board meetings & training sessions · AV + Wi-Fi ready.",
                        "badge": "MOST BOOKED",
                        "price_cents": 72000,
                        "duration_hours": "4.00",
                        "default_start_time": "09:00:00",
                        "display_order": 10,
                        "max_bookings": 1
                    }
                ],
                "addons": [
                    {
                        "id": 10,
                        "name": "Barefoot Bowls BBQ — Classic Sizzle",
                        "description": "Gourmet sausages, burger patties…",
                        "price_cents": 2600,
                        "price_suffix": "per guest",
                        "countable": true,
                        "default_quantity": 10,
                        "default_selected": false,
                        "display_order": 10,
                        "applies_to_slot_ids": null
                    }
                ]
            }
        ],
        "settings": {
            "deposit_percent": 15,
            "balance_due_days_before": 21,
            "is_active": true
        }
    }
}
```

**Key fields for the UI:**

- `packages[].sub` → the small italic-ish copy under the package name on the picker.
- `packages[].bond_cents` + `bond_label` → render `$300 Security bond (refundable)` if non-zero.
- `slots[].label` → the slot card title.
- `slots[].sub` → the target-market one-liner under the title (replace all the current hardcoded badges with this).
- `slots[].badge` → owner-managed marketing badge, max 40 char. `null` when not set. When present, render as the pill above the card title (the "MOST BOOKED" / "SAVE 15%" treatment in the current mock). Owners set/clear this in the CRM package editor. Don't fabricate a default — a null badge means "no badge".
- `slots[].price_cents` → `/ 100` for dollars. Save as `$720`, not `$720.00` — the design treatment.
- `slots[].duration_hours` → pre-formatted, e.g. `4.00` → render as `4 hours`. Strings in the JSON because MySQL DECIMAL; `parseFloat(…)` before rendering.
- `slots[].max_bookings` → how many parallel bookings the slot can hold. Almost always `1` for exclusive venue slots. Used in availability math below.
- `addons[]` — pretty straightforward. `countable: true` means per-guest / per-platter spinner input, default to `default_quantity`. `countable: false` means single-pick (checkbox), quantity always 1.
- `addons[].applies_to_slot_ids` → optional slot-scope filter. `null` = applies to every slot (current behaviour, back-compat). `number[]` = applies only when the chosen slot's id is in the array. When a date + slot is picked, hide addons whose scope excludes the chosen slot. Backend is defensive — submitting an out-of-scope addon returns 400 `addon_not_in_scope`, but the FE should be the primary filter so renters never see them.
- `settings.deposit_percent` → drives the deposit line on the quote.

### 2.2 `GET /public/clubs/{slug}/venue-availability?from=YYYY-MM-DD&to=YYYY-MM-DD[&package_id=<id>]`

Parameters:

- `from`, `to` — ISO date strings, club-local dates (NZST for Naenae). Inclusive on both ends.
- `package_id` (optional) — scopes the answer to one package. Omit to get taken slots across every package in the club. On the per-package booking page, always pass it.

Response:

```json
{
    "status": "success",
    "data": {
        "taken": [
            { "date": "2026-12-17", "slot_id": 12, "package_id": 9 },
            { "date": "2026-12-17", "slot_id": 14, "package_id": 9 }
        ],
        "lead_blocked_until": "2026-11-22T22:00:00.000Z",
        "min_lead_hours": 48
    }
}
```

**What "taken" means:** a slot is in the list when any of the following is true on that date:

- **Directly booked** — a live booking exists against it (see status rules below), AND the slot's capacity (`max_bookings`) is used up.
- **Overlap-blocked** — a different slot in the same package is booked, and its time window intersects this slot's time window. Example: Naenae's Clubhouse package has Morning (9–1), Afternoon (2–6), Evening (6–11), Full Day (9–11). Book Afternoon on Dec 17 → both slot 12 (Afternoon, directly booked) and slot 14 (Full Day, overlap-blocked) appear in `taken[]` for that date.

Live statuses:

- `confirmed` — admin approved or Stripe paid.
- `pending` — admin hasn't actioned the enquiry yet (but it's holding the slot).
- `pending_payment` AND `created_at >= NOW() - 24h` — in-flight Stripe Checkout. Older rows are stale (renter walked away) and aren't returned.

Not returned: `declined`, `cancelled`, `refunded`, `partially_refunded`, `completed`.

**Overlap scope:** only within the same package. Cross-package overlap ("Whole Shebang" blocking "The Clubhouse" because they share the room) is **not** enforced yet — that needs resource-group config and is a follow-up brief.

**Capacity (`max_bookings > 1`):** the direct-booked check only trips when all capacity is used. If `max_bookings: 3` and only 1 booking exists, that slot stays absent from `taken[]`. The overlap check still runs against the booked slot's window, so sibling slots with overlapping windows can still be blocked — that's the correct behaviour.

**Lead time (`lead_blocked_until`, `min_lead_hours`):** ISO-8601 UTC timestamp — any slot whose start-time is before this is server-rejected on submit. FE should grey any day / slot whose computed start (`booking_date` + `default_start_time` in the club's tz) is earlier than `lead_blocked_until`. `min_lead_hours` is the integer that produced it (useful for copy: "Bookings need at least 48 hours notice"). Admin-created bookings go through a different handler and are not subject to this check.

**Cache headers:** `Cache-Control: public, max-age=60` — fresh enough for renters, kind to the DB.

---

## 3. How to render

### 3.1 Package selection → slot list

On mount of `/venue-hire/book?space=<slug>`:

1. `GET /public/clubs/{slug}/venue-packages`.
2. `const pkg = data.packages.find(p => p.slug === qs.space)`. If none → show a "That package isn't available" state (or default to the first `is_active` package).
3. Render the four slot cards from `pkg.slots`, sorted by `display_order` (the API already sorts; preserve order).
4. Replace the hardcoded "MOST BOOKED" / "BAR STAFF INCL." / "SAVE 15%" badges with `slot.sub`. That field holds the target-market copy today ("Corporate half-day workshops, board meetings & training sessions · AV + Wi-Fi ready."). No separate badge data source — if the design wants flagship badges, that needs a new column, flag it and we'll add one.
5. Render the add-on grid from `pkg.addons`.
6. Render `bond_cents` + `bond_label` near the quote summary if non-zero.

### 3.2 Calendar availability

On mount + whenever the visible month changes:

1. `GET /public/clubs/{slug}/venue-availability?from=<first-of-month>&to=<last-of-month>&package_id=<pkg.id>`.
2. Index the response into a map: `Map<ISODate, Set<slot_id>>`.
3. For each visible cell, compute day status:
   - `takenSlotsToday = new Set(data.taken.filter(t => t.date === dateIso).map(t => t.slot_id))`
   - `fullSlotCount = pkg.slots.length`
   - `freeSlotCount = fullSlotCount - takenSlotsToday.size`
   - If `freeSlotCount === fullSlotCount` → day label: **FREE** (today's green).
   - If `freeSlotCount === 0` → day label: **FULL** (greyed out, not clickable).
   - Otherwise → day label: **{freeSlotCount} of {fullSlotCount} FREE** (partial, clickable).

### 3.3 Slot card after a date is picked

Once the user selects a date on the calendar:

- Grey out any slot card whose `slot.id` is in `takenSlotsForThatDay`. This now covers both directly-booked slots and overlap-blocked siblings (Full Day goes grey when Afternoon is booked — the backend does the overlap math, you just consume `taken[]`).
- Grey out any slot whose computed start is earlier than `lead_blocked_until` (see §3.4).
- Non-grey cards remain clickable → add to the quote.
- Render `slot.badge` as a pill above the card title when non-null. See §2.1's `slots[].badge` note — purely an owner-driven marketing field, no fallback.
- **Filter addons by the chosen slot:** when displaying the add-on grid after a slot is picked, hide any addon whose `applies_to_slot_ids` is a non-null array that doesn't include the chosen `slot.id`. Keep showing every addon where `applies_to_slot_ids === null` (the common case).

### 3.4 Lead-time and past dates

- **Past dates:** always grey, not clickable. Use the renter's local date (NZST for Naenae) — don't trust the browser clock blindly, derive from luxon/date-fns with `Pacific/Auckland`.
- **Lead time (shipped):** `/venue-availability` returns `lead_blocked_until` (ISO-8601 UTC) + `min_lead_hours` (integer). Grey any slot whose computed start (`date` + `default_start_time` in Pacific/Auckland) is earlier than `lead_blocked_until`. Naenae is currently 48h; the number is per-club. If the renter still tries to submit a locked-out slot (stale page, clock skew), the submit endpoint returns 422 `lead_time_violated` with `{ min_lead_hours, earliest_bookable_at }` — surface that in a toast and refresh the calendar.

---

## 4. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
SLUG="nae-nae-bowling-club"

# 1. Packages for Naenae
curl -s "$VENUE/public/clubs/$SLUG/venue-packages" | jq '.data.packages[] | { slug, name, bond_cents, slot_count: (.slots|length), addon_count: (.addons|length) }'

# 2. Availability for December 2026, scoped to Clubhouse (id 9)
curl -s "$VENUE/public/clubs/$SLUG/venue-availability?from=2026-12-01&to=2026-12-31&package_id=9" | jq
# Expect: taken: [{ date: "2026-12-17", slot_id: 12, package_id: 9 }]

# 3. Availability without scoping — every taken slot in Dec across all packages
curl -s "$VENUE/public/clubs/$SLUG/venue-availability?from=2026-12-01&to=2026-12-31" | jq '.data.taken | length'

# 4. Wrong slug → 404 (catches the subdomain-vs-slug mistake)
curl -s "$VENUE/public/clubs/naenae-bowling-club/venue-packages" | jq
# → status: "error", code: "not_found"
```

---

## 5. Pass criteria

- ✓ Navigating to `?space=the-clubhouse` shows the Clubhouse slots at $720 / $720 / $900 / $2,340. Navigating to `?space=green-bbq` shows $220 / $220 / $400.
- ✓ Each slot card's secondary copy is the `sub` from the API, not a hardcoded badge list.
- ✓ The $300 bond displays when and only when `bond_cents > 0`.
- ✓ Add-ons render from `addons[]` with price + `price_suffix` (per guest, per platter, base).
- ✓ Calendar cells reflect real `taken[]` data. Dec 17 NZST shows **3 of 4 FREE** (Afternoon is taken), Dec 18 shows **FREE** (nothing booked).
- ✓ Clicking a booked slot on a chosen date is impossible (greyed card, no click handler).
- ✓ Clicking a lead-time-blocked slot is impossible (slot start < `lead_blocked_until` → greyed).
- ✓ Clicking an overlap-blocked slot is impossible (e.g. Full Day disabled on Dec 17 because Afternoon is booked that date).
- ✓ Slot badges render only when `slot.badge` is a non-null string from the API.
- ✓ After picking a slot, only addons with `applies_to_slot_ids === null` or containing the chosen `slot.id` appear in the addon grid.
- ✓ Switching months refetches and re-renders.
- ✓ No "fake" copy ("MOST BOOKED", "SAVE 15%") in the DOM once wired — all text is either `label`, `sub`, `badge`, or system-rendered counts.

---

## 6. Non-goals

- **Multi-day venue takes** (e.g. Fri evening + Sat all-day as one booking). Each booking is one package + one slot + one date; multi-day is a design question.
- **Capacity > 1 UX.** Supported in the data model (`slots.max_bookings`) but not relevant yet for Naenae (all slots are exclusive).
- **Cross-package overlap.** Today's rule is same-package only. Follow-up when owner-defined resource groups land (Whole Shebang sharing rooms with The Clubhouse, etc.).
- **Admin reschedule UI side effects on the public calendar.** Public `taken[]` is live-recomputed on every call so an admin cancel/decline is visible on next refresh.

---

## 7. Shipped answers (2026-11-20)

All four open questions from the first drop have landed on the backend. FE work for each is scoped above in §2–§5.

| Question | Decision | Shape |
|---|---|---|
| **Q1. Marketing badges on slot cards.** | Shipped. Owner-managed free-text (VARCHAR 40) per slot. | `slots[].badge: string \| null`. See §2.1 + §3.3. |
| **Q2. Server-enforced lead time.** | Shipped. Per-club setting (`club_venue_settings.min_lead_hours`), default 24h, Naenae = 48h. | Availability returns `lead_blocked_until` + `min_lead_hours`. Submit rejects with 422 `lead_time_violated`. See §2.2 + §3.4. |
| **Q3. Full-Day vs individual slot overlap.** | Shipped. Time-based within-package rule — no owner config, derived from `default_start_time` + `duration_hours`. Full Day (9am–11pm) blocks Afternoon (2pm–6pm) automatically. | Overlap-blocked slots join `taken[]` on the same response. Submit rejects with 409 `slot_unavailable` carrying `conflict_slot_id` + `conflict_label`. See §2.2 + §3.3. Cross-package overlap (shared rooms between packages) is a follow-up when resource groups land. |
| **Q4. Add-on availability per slot.** | Shipped. Optional `number[]` scope stored as JSON on `venue_addons`. `null` = applies to every slot (zero migration risk — every existing addon is null). | `addons[].applies_to_slot_ids: number[] \| null`. See §2.1 + §3.3. Submit rejects with 400 `addon_not_in_scope` as a defensive backstop. |

### Error-handling checklist for `POST /venue-bookings` (+ `/checkout`)

| Status | code | What to show the user |
|---|---|---|
| 422 | `lead_time_violated` | "Bookings need at least N hours notice." Use `data.min_lead_hours`. Refresh availability. |
| 409 | `slot_unavailable` (capacity) | "That slot is fully booked — please choose a different time or date." Refresh availability. |
| 409 | `slot_unavailable` (overlap) | "That slot overlaps `conflict_label` which is already booked on this date." Refresh availability. (Same code, different data shape — `conflict_slot_id` + `conflict_label` present only on overlap.) |
| 400 | `addon_not_in_scope` | Shouldn't fire if FE filtering is correct. Log + re-fetch packages. |

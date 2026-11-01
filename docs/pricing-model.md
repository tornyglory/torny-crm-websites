# Torny OS — Pricing Model

Running decision log for how we monetise Torny. Each section captures the mechanism, the decision, and any open questions. When a line item is ready to build, it gets a backend brief.

Last updated: 2026-11-01

---

## 1. Subscription — the baseline

**$79 / month** per club. Anchors Torny as a serious product (comparable: Clubforce ~$50–100/mo, Mindbody $150+/mo).

**Status:** decided in principle; not yet implemented.

**Open questions:**
- What exactly does $79/mo unlock vs. a free tier? Right now there's no gated feature — the subscription has to justify itself on the bundle.
- Billing cadence: monthly only, or annual with a discount (e.g. $790/yr = ~2 months free)?
- Trial / grace period for onboarding?

---

## 2. Venue hire bookings — deposit split

**Requires Stripe Connect.** No Stripe = no venue hire. **15% deposit charged at checkout, split 7% to Torny / 8% to the club.** Settled via Stripe Connect `application_fee_amount` — one `PaymentIntent`, split happens automatically.

**Flow:**
1. Renter completes the venue-hire booking form on the club's public site.
2. At checkout, Stripe charges 15% of the full booking value.
3. 7% lands in Torny's platform account (our fee).
4. 8% lands in the club's connected Stripe account (their deposit — functions as "renter has skin in the game" money).
5. Club invoices the renter for the remaining 85% separately (bank transfer, their own invoicing, etc.) — Torny never touches it.

**Framing at checkout:** itemise the two components (e.g. *Deposit $8 · Booking service fee $7*) rather than hiding under a single "15% deposit" line. Honest + matches the design voice + heads off the "surprise fee" complaint when a club admin reconciles their Stripe statement.

**Status:** decided; backend brief next.

**Open questions:**
- Refund policy when the **club** cancels (standard: refund renter in full, Torny eats the Stripe refund fee).
- Refund policy when the **renter** cancels (standard: club keeps their 8% if outside the cancellation window, Torny keeps the 7% regardless — it's a booking service fee, not a deposit).
- Guard against clubs under-stating booking values to dodge the 7% (e.g. "$100 hall + $400 cleaning deposit") — TOS clause for v1, pricing-anomaly detector later.

---

## 3. Tournament entries — flat $1 per entry

**Requires Stripe Connect.** No Stripe = no online tournament entries. **Full entry fee charged through Torny; Torny keeps $1 per entry; the rest transfers to the club.** Same Stripe Connect mechanism as venue hire — single `PaymentIntent` with `application_fee_amount: $1`.

**Flow:**
1. Entrant submits their tournament entry on the club's public site.
2. Stripe charges the full entry fee ($X).
3. $1 lands in Torny's platform account.
4. $X - $1 lands in the club's connected Stripe account.

**Status:** direction set; two decisions still open before brief:

**Open questions:**
- **Per entry or per player?** A fours tournament entry is one entry but four players. Does the team's entry fee cost $1 to Torny, or $4? Recommendation: **per entry** — the organiser pays, the entry is the unit, and $4 on a $200 fours fee is 2% which feels high.
- **Minimum entry fee?** A $5 fun-night entry means Torny takes 20%. Options: a floor (no fee under $X), a sliding scale (greater of $1 or Y%), or just accept it on the long tail. Recommendation: **flat $1, no floor** — simpler, and clubs running $5 fun nights can either absorb it or pass it on at checkout as a line item.
- **Refund on withdrawal?** If an entrant pulls out, does their $1 come back or stay with Torny? Recommendation: **non-refundable** — same logic as the venue booking service fee.

---

## 4. Membership payments — nothing (included)

**No per-transaction fee on membership subs.** Member sub payments flow through the club's own Stripe account; Torny doesn't skim. Processing is bundled into the $79/mo subscription — that's what the subscription buys.

**Rationale:** membership subs are the club's core revenue. Taking a slice of it would make treasurers price-shop against competitors every renewal; keeping it clean turns the $79/mo into a real value prop ("unlimited Stripe-powered recurring billing included") and tells a simple story — subscription for the platform, usage fees only on money we actually help you bring in (venue hire, tournaments).

**Status:** decided.

---

## 5. Membership subs — invoice flow for non-Stripe payments

Venue hire and tournament entries both require Stripe Connect (§§ 2–3). **Membership subs don't** — clubs can keep taking subs via bank transfer, cash, or cheque, and admins log the payment manually. This section is only about that manual flow.

**Invoice (v1 — simple):**

Clubs set up once in **Settings → Payments → Bank details**:
- Bank account name
- Bank account number
- Reference prefix (optional, e.g. "NBC-" for Naenae Bowling Club)

Every outstanding member sub gets a **stable reference number** so bank transfers can be reconciled by the treasurer:
- `{prefix}MEM-{member_number}-{year}` → `NBC-MEM-42-2026`

The reference stays stable across re-sends so the treasurer can always match a bank line to the right member.

**Invoice delivery:** admin hits "Send invoice", Torny emails the member a page with amount + due date + bank details + reference number, wrapped in the club's email template (brief 45). Admin manually marks it paid when the money shows up (same pattern we already use for member payments — brief 68).

**Clubs using Xero / MYOB / anything else:** Torny's invoice flow is optional. If the treasurer already invoices via Xero, they just skip "Send invoice" and come back to Torny to mark the payment received once Xero shows it as paid. Torny's job is to be the source of truth for *who's paid* and *when*; the invoice-issuance workflow is a convenience for clubs that don't already have one.

**Status:** decided direction, v1 = status marker + bank details + stable reference + manual "mark paid". Full PDF generation + branded invoice assets is a v2 ask.

---

## 6. What's not in scope for pricing

Explicitly out — list them so they don't quietly creep in:

- **SMS / email send volume.** Email templates and campaigns are included in the $79/mo. No per-send fees.
- **Honour board / events / content blocks.** All included.
- **Member imports / exports.** No per-row fee.
- **Website hosting.** Public site is included in the subscription.

---

## 7. What's next

| # | Item | Depends on | Who |
|---|------|------------|-----|
| 1 | Backend brief for Stripe Connect onboarding + venue-hire split PaymentIntent | § 2 decided | Felicity |
| 2 | Backend brief for tournament-entry split PaymentIntent | § 3 open questions resolved | Felicity |
| 3 | Pricing + plan management in Settings (subscription side) | § 1 open questions resolved | — |
| 4 | TOS clause for "fair booking value" | § 2 decided | — |
| 5 | Bank details + reference-number settings UI (`Settings → Payments`) | § 5 decided | — |
| 6 | Backend brief for invoice issuance + stable reference numbers | § 5 decided | Felicity |

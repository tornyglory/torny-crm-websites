# Brief 125 — Platform-wide transactions ledger

**Status:** proposed. Not yet scoped on the backend roadmap.

**Feature:** a single endpoint that lists every money-moving transaction across every club, with the same polymorphic shape as the per-account drilldown (brief 123 §7.1) plus an identifying `club` object on each row. Powers a new `/admin/transactions` page in the platform admin portal — "show me all the money flowing through Torny and how much of it is ours."

**Why this, not reuse per-account N times:** per-account aggregation from the FE is a scaling and correctness trap — can't paginate across N accounts in one cursor, can't sort by date globally, can't aggregate on gross / platform-take without a double-pass. The data lives in two tables (`venue_bookings` + `tournament_entries`); the existing per-account query is one `UNION ALL` + a `WHERE club_id = ?` — removing the WHERE and adding the club join is cheap and correct.

**Prereq:** brief 123 Phase 3 shipped — `/admin/accounts/{id}/transactions` is live. This brief is the platform-wide sibling.

**Related briefs:**
- Brief 123 Phase 3 §7.1 — per-account transactions. Parallel shape; this brief's response adds a `club` field per row.
- Brief 123 §5 — platform metrics/billing. The aggregates on that endpoint and this one should RECONCILE to the cent — both are different projections of the same raw tables.
- Brief 122 — paid add-on blocks. When add-ons ship, `addon_charge` rows start showing up in this endpoint's stream.

---

## 1. Base URL

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Platform-owner JWT required (same gate as every brief 123 endpoint).

---

## 2. `GET /admin/transactions`

```
GET /admin/transactions
    ?window=7d|30d|90d|ytd|all                     default 30d
    ?filter[kind]=venue_booking,tournament_entry   comma-separated, repeatable
    ?filter[status]=succeeded|refunded|failed|pending
    ?filter[club_id]=<id>                          scope to one club (equivalent to /admin/accounts/:id/transactions)
    ?q=<search>                                    matches club name, member name, member email
    ?sort=-at (default) | -amount_cents | -platform_fee_cents
    ?limit=50 (max 200) & ?cursor=<opaque>
```

### Response

Row shape mirrors brief 123 §7.1 with one addition — a `club` object so the FE can render which account each row belongs to without a second lookup:

```jsonc
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "vb_812",
        "at": "2026-11-20T18:15:00.000Z",
        "kind": "venue_booking",
        "amount_cents": 45000,
        "platform_fee_cents": 1125,
        "club_net_cents": 43875,
        "stripe_charge_id": "pi_3P…",
        "stripe_dashboard_url": "https://dashboard.stripe.com/payments/pi_3P…",
        "ref": {
          "kind": "venue_booking",
          "id": 812,
          "label": "The clubhouse · Full Day · 9am – 11pm"
        },
        "member": { "id": 5522, "name": "Grace Whittaker", "email": "g.whittaker@example.com" },
        "status": "succeeded",
        // NEW on this endpoint — identifies the tenant the row belongs to
        "club": {
          "id": 5,
          "name": "Naenae Bowling Club",
          "subdomain": "naenae-bowling-club"
        }
      }
    ],
    "next_cursor": null,
    "total_count": 142,
    "aggregates": {
      "gross_cents": 3820500,
      "platform_take_cents": 24380,
      "effective_take_rate": 0.00638,
      "count_by_kind": {
        "venue_booking": 128,
        "tournament_entry": 14
      },
      // NEW on this endpoint — top clubs by GMV in the window, for the
      // dashboard tile. Cap at 5 rows server-side; FE renders only what
      // fits. NOT a general facet — don't use this for filter UI.
      "top_clubs_by_gmv": [
        { "club_id": 5, "name": "Naenae Bowling Club", "gross_cents": 1824500, "platform_take_cents": 11915 },
        { "club_id": 3, "name": "Melbourne Bowling Club", "gross_cents": 980000, "platform_take_cents": 6125 }
      ]
    }
  }
}
```

### Why no `club_net_cents` aggregate

Deliberately omitted. `gross - platform_take` doesn't equal club_net (Stripe takes its own cut from club_net before payout). Surfacing a derived "clubs received X" across the platform would be wrong; leave it per-row where Stripe already attributed it.

### Reconciliation requirement

`aggregates.gross_cents` on this endpoint, with no filters, in window `30d`, MUST equal `GET /admin/metrics/billing?window=30d → data.transactional.gmv_cents`. Same for `platform_take_cents` ↔ `data.transactional.platform_take_cents`. These are different views of the same underlying tables; the backend must assert this in integration tests so a drift bug fires in CI, not in production.

---

## 3. Status + kind handling

Unchanged from brief 123 Phase 3:
- `kind` is the forward-compatible union (`venue_booking`, `tournament_entry`, `subscription_charge`, `addon_charge`, …).
- `status` maps per-kind DB enums into the public `succeeded | refunded | failed | pending` set per brief 123 §7.1.

When `subscription_charge` + `addon_charge` land (their own table ships), they flow into this endpoint automatically. No contract change.

---

## 4. Error codes

Same gate + validators as brief 123 §8. New codes:
- `400 bad_filter` if `filter[club_id]` is a non-integer.

Nothing else new.

---

## 5. FE consumption

Admin portal gains a top-level `/admin/transactions` page with:

- **Window toggle + big-number aggregate tiles** at top: total GMV, total platform take, effective take rate, count-by-kind pills. Uses `aggregates` from this endpoint; no additional fetch.
- **Top clubs by GMV** horizontal strip (rendered from `aggregates.top_clubs_by_gmv`), each chip click-through to `/admin/accounts/:id` for the drilldown.
- **Transaction table**: date · club · member · kind · amount · platform fee · status · Stripe deep-link. Sortable by date / amount / platform fee. Filter chips: kind, status. Search input against `q`. Load-more cursor pagination (matches the Accounts list pattern).

Nav item added to the admin sidebar between Accounts and Users ("Transactions" or "Ledger" — FE's call).

New api-client export:
```ts
admin.listAllTransactions({ window, filter, sort, q, limit, cursor }): Promise<AdminTransactionsList>
// shape: same as listTransactions but each row.club is present and aggregates.top_clubs_by_gmv is surfaced
```

FE will type the new fields on its side and ship the view against them; no FE-side blocking issues.

---

## 6. Verification checklist

Before marking shipped:

- [ ] `GET /admin/transactions?window=30d` returns the row shape in §2 with `club` populated on every row
- [ ] `?filter[club_id]=5` returns the same rows (in the same order) as `GET /admin/accounts/5/transactions?window=30d` — this is the reconciliation guarantee
- [ ] `aggregates.gross_cents` on `?window=30d` equals `metrics/billing?window=30d → transactional.gmv_cents`
- [ ] `aggregates.platform_take_cents` on `?window=30d` equals `metrics/billing?window=30d → transactional.platform_take_cents`
- [ ] `aggregates.top_clubs_by_gmv` sum of `gross_cents` ≤ `aggregates.gross_cents` (top 5 is a subset)
- [ ] `?sort=-platform_fee_cents` returns the highest-platform-take row first
- [ ] `?q=naenae` surfaces Naenae's rows; `?q=grace` surfaces rows where the member's name matches
- [ ] Non-platform_owner → `403 not_platform_owner`

---

## 7. Non-goals

- **Per-member aggregation.** No `top_members_by_spend` or similar — scales linearly with membership and isn't a platform-admin question. If support ever asks, drill into the club.
- **Monthly / weekly trend arrays.** Brief 123 Phase 3b owns trends; don't duplicate here.
- **Writes.** Read-only endpoint. Refunds + refund triggers live on the Stripe dashboard where we deep-link.
- **CSV export.** Brief 123 §12 marks CSV export as a non-goal across the admin surface. Same here. If finance needs a quarterly dump, they run SQL.

---

## 8. Contact

Nev on #torny-eng.

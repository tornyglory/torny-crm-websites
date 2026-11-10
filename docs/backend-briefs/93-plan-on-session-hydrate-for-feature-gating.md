# Brief 93 — `plan` on session hydrate so the CRM can gate nav + website blocks

**Scope:** CRM_BASE · `GET /me`, `POST /login`, `POST /register` · additive field only.

**Prereq:** brief 86 (plan tiers landed) + brief 87 (subscription flipping). Nothing in those endpoints changes behaviour — we just want the current plan to surface on the admin's session so the CRM can render the right UI on first paint.

---

## 1. The ask

Add a `plan: 'starter' | 'pro'` field to each `UserClub` entry inside the `clubs[]` array returned by every endpoint that hydrates the admin's session.

**Affected endpoints:**

| Endpoint | Shape |
|---|---|
| `GET  /me`       | `data.user.clubs[*]` |
| `POST /login`    | `data.user.clubs[*]` |
| `POST /register` | `data.user.clubs[*]` |

**Before (current):**
```json
"clubs": [
  { "id": 42, "name": "Naenae Bowling Club", "role": "owner", "title": null }
]
```

**After:**
```json
"clubs": [
  { "id": 42, "name": "Naenae Bowling Club", "role": "owner", "title": null, "plan": "pro" }
]
```

That's the whole ask. One new string field, one of two values.

---

## 2. Why

The CRM nav shows every feature today — Members, Applications, Enquiries, Events, Team selections, Tournaments, Honour board, Venue bookings, Venue packages, Website, Communications, Settings. Five of those (team selections, tournaments, honour board, venue bookings, venue packages) are Pro-only per brief 86.

On a Starter plan the admin sees them, clicks, and hits a dead-end or an upgrade nag — bad first impression. We want to:

- Lock them out of Pro-only sections with an "Upgrade to Pro" affordance in the nav.
- Hide Pro-only blocks from the website editor's block picker (otherwise an admin builds a page, saves, and nothing renders because the content-blocks package filters by plan at render time).

Both are first-paint decisions. The data has to be on the session hydrate — not fetched lazily — otherwise the nav flickers (all items, then filter-out) and the block picker has to spinner before it can render.

Could the CRM instead call `GET /clubs/:cid/plan` on boot? Technically yes, but:

- That's a second round-trip blocking first paint.
- The plan is already loaded server-side when hydrating the session (brief 86 added `clubs_data.plan`), so there's no extra DB hit — just copy it into the response shape.
- Keeping plan on the UserClub lets the sidebar club-switcher show the plan of each club at a glance (a nice-to-have for admins who own both a Starter demo club and a Pro production club).

---

## 3. Semantics

- **Values:** `'starter'` | `'pro'` — exactly matches the `PlanKey` type in `@torny/api-client` (`resources/billing.ts:13`). No `null`, no `'none'` — every club has a plan, default `'starter'` per brief 86 §4.
- **Freshness:** reflects the current value of `clubs_data.plan` at response time. Stripe webhook updates (brief 87 §6) flip this row before the admin sees any UI change, so the hydrate response is always consistent with Billing → Plan.
- **Scope:** returned on every club the user has membership in, not just the "current" one. The CRM's club-switcher needs plan per club.

---

## 4. No matching field on the big `Club` object yet?

Probably already landed in brief 86 for `GET /clubs/:id` and `GET /clubs/resolve` — the public hydrate needed it to know which widgets to render on the public site. Spot-check:

```bash
curl "$CRM_BASE/clubs/42" | jq '.data.plan'
# expect "starter" or "pro"
```

If `plan` is missing there too, add it on the same ticket while you're in that query — same source column, same shape.

---

## 5. Verification

```bash
# 1. /me carries plan on every membership
curl "$CRM_BASE/me" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.user.clubs[] | {id, name, role, plan}'

# Expect:
# { "id": 42, "name": "Naenae Bowling Club", "role": "owner", "plan": "pro" }

# 2. Login path
curl -X POST "$CRM_BASE/login" -d '{"email":"a@b","password":"…"}' \
  | jq '.data.user.clubs[0].plan'
# → "pro" or "starter"

# 3. Register path (new admin on default Starter)
curl -X POST "$CRM_BASE/register" -d '{"name":"Test Co","email":"new@test","password":"…"}' \
  | jq '.data.user.clubs[0].plan'
# → "starter"

# 4. Starter → Pro via Stripe Checkout, then re-hit /me
curl "$CRM_BASE/me" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.user.clubs[0].plan'
# → "pro" (webhook already flipped the row)
```

---

## 6. Non-goals

- Not asking for `subscription_status` or `trial_ends_at` on the session. Those stay on `GET /clubs/:cid/plan` where Billing already reads them. The session only needs enough to drive nav + block-picker visibility.
- Not asking for a `features: string[]` array on the session either. Plan + a FE-side plan→features map is enough for v1. If features drift per customer (grandfathered Pro, enterprise comp, etc.) in future, revisit.
- No new endpoint. All three existing endpoints get one new field each.

---

## 7. Once shipped

I'll:

1. Add `plan: PlanKey` to the `UserClub` interface in `packages/api-client/src/resources/auth.ts`.
2. Mirror it onto `clubStore.current` so `clubStore.current?.plan` is available to every view.
3. Wire the CRM nav (`apps/crm/src/layouts/CrmShell.vue`) to hide / lock Pro-only items when `plan === 'starter'`.
4. Wire the website editor's block picker to hide Pro-only block types when `plan === 'starter'`.
5. Close this brief.

No downstream FE changes needed before this ships — the fields are additive and the current UI just ignores them.

# Plan tiers + feature gating — phase 1 of the Torny OS subscription model

**Feature:** introduce two product tiers (**Starter** / **Pro**) that gate which parts of the CRM a club can access. The money layer (Stripe subscriptions, pricing page, self-serve upgrade) comes in follow-up briefs — this one just establishes the data model + feature allowlist + gating UX so the rest can hang off it. Admins can be moved between tiers today via a support-only endpoint; real billing arrives in phase 2.

**Status:** this brief is phase 1 of four. Brief 87 adds Stripe subscriptions, 88 the public pricing page, 89 the in-app upgrade flow. Shipping this brief alone gives us the mental model and lets internal admins explore the Pro-gated experience before any payment infrastructure is wired.

**Pricing** (final, for context — but no money moves in this brief):
- **Starter — $39/mo:** CRM, emailing, membership management, payments, event calendar, general enquiries.
- **Pro — $79/mo:** everything in Starter + team announcements, honour boards, tournament entries, venue hire.

**Related briefs:**
- Brief 72 — Stripe Connect for venue-hire deposits. Separate from this brief's subscription billing (clubs charge their renters; Torny charges the clubs).
- Brief 80 — `header_display` on navigation. Same pattern: enum on a core table, echoed on the public hydrate.

---

## TL;DR

- Add `clubs.plan ENUM('starter','pro') NOT NULL DEFAULT 'starter'` — everyone starts on Starter, Pro is opt-in.
- Define a **feature allowlist** server-side (see §3). Each plan has a static set of features.
- `GET /clubs/{cid}/plan` returns the current plan, its allowlist, and the derived `is_pro` flag.
- `PATCH /clubs/{cid}/plan` — superadmin only — flips a club's plan. Pure manual override for now; Stripe wiring follows in brief 87.
- `GET /public/clubs/{slug}/site` and `GET /clubs/resolve` include the plan in the payload so the FE can gate before any route resolves.
- **FE builds (in a follow-up commit):** a `useFeature('feature_key')` composable, sidebar filters, router guards, and a shared "Upgrade to Pro" nudge page.

Backend lift: one column, one GET, one PATCH, hydrate additions. Everything else is FE.

---

## 1. Schema

```sql
ALTER TABLE clubs
  ADD COLUMN plan ENUM('starter', 'pro') NOT NULL DEFAULT 'starter';
```

No backfill — every existing club defaults to `starter`. A migration follow-up in phase 2 will move early-access clubs that already have features we're now gating behind Pro. For phase 1 the superadmin-only PATCH (§4) is the escape hatch.

---

## 2. Plan tiers — the data model

Server-side, a plan is defined by:

```ts
interface PlanDefinition {
  key: 'starter' | 'pro'
  display_name: string
  monthly_price_cents: number        // informational; real pricing lives in Stripe later
  features: Set<FeatureKey>
}
```

The definitions are **static config**, not DB rows — simpler to version in code, no risk of a half-populated table. Pseudo-shape:

```ts
const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: 'starter',
    display_name: 'Starter',
    monthly_price_cents: 3900,
    features: new Set([
      'dashboard', 'members', 'applications', 'enquiries',
      'events', 'communications', 'payments',
      'website', 'settings', 'profile',
    ]),
  },
  pro: {
    key: 'pro',
    display_name: 'Pro',
    monthly_price_cents: 7900,
    features: new Set([
      // Everything Starter has, plus:
      ...STARTER_FEATURES,
      'team_selections', 'team_announcements',
      'tournaments', 'honour_board',
      'venue_bookings', 'venue_packages',
    ]),
  },
}
```

---

## 3. Feature keys — the allowlist

One string key per gatable surface. Used by the FE for both sidebar filtering and route guards. Keep the keys stable — once in production they're a contract.

| Key | What it gates | Starter | Pro |
|---|---|---|---|
| `dashboard` | `/dashboard` + overview tiles | ✓ | ✓ |
| `members` | `/members`, member profile, add-member flow | ✓ | ✓ |
| `applications` | `/applications` + approve/decline | ✓ | ✓ |
| `enquiries` | `/enquiries` + response composer | ✓ | ✓ |
| `events` | `/events` + event calendar on public site | ✓ | ✓ |
| `communications` | `/communications` + bulk email + templates | ✓ | ✓ |
| `payments` | Member payments table + record-payment flow | ✓ | ✓ |
| `website` | `/website` editor + site chrome settings | ✓ | ✓ |
| `settings` | `/settings` (billing, brand, navigation, SEO) | ✓ | ✓ |
| `profile` | `/profile` (user account settings) | ✓ | ✓ |
| `team_selections` | `/team-selections` list + editor | — | ✓ |
| `team_announcements` | Team announcement composer + sends | — | ✓ |
| `tournaments` | `/tournaments` list + create + draws | — | ✓ |
| `honour_board` | `/honour-board` + honour entries | — | ✓ |
| `venue_bookings` | `/venue-bookings` inbox + detail + refund | — | ✓ |
| `venue_packages` | `/venue-packages` list + editor | — | ✓ |

The lists are mirrored on both server and FE. Server is the source of truth — any 403/upsell logic defers to what `GET /clubs/{cid}/plan` returns.

---

## 4. `GET /clubs/{cid}/plan`

Admin+ (owner, admin, committee). Returns the club's current plan and its allowlist.

```jsonc
{
  "status": "success",
  "data": {
    "plan":                "starter",
    "display_name":        "Starter",
    "monthly_price_cents": 3900,
    "features":            ["dashboard", "members", "applications", "enquiries", "events", "communications", "payments", "website", "settings", "profile"],
    "is_pro":              false,
    "upgradeable_to":      ["pro"]
  }
}
```

Pro response — same shape, different values:

```jsonc
{
  "status": "success",
  "data": {
    "plan":                "pro",
    "display_name":        "Pro",
    "monthly_price_cents": 7900,
    "features":            ["dashboard", "members", "applications", ... , "venue_bookings", "venue_packages"],
    "is_pro":              true,
    "upgradeable_to":      []
  }
}
```

`upgradeable_to` is an array so phase 3 can add further tiers without a shape break.

### Errors

| HTTP | code | meaning |
|---|---|---|
| 403 | `forbidden` | caller below committee |
| 404 | `not_found` | club_id doesn't exist |

---

## 5. `PATCH /clubs/{cid}/plan`

**Superadmin only** (user with the `torny_support` role or similar — gate via whatever "internal support" check already exists for this kind of operation, or ship a header-based JWT role check and let Felicity tell you which admin accounts should have it). Until brief 87 ships the billing flow, this is the only way to flip a club's plan.

### Request

```jsonc
{ "plan": "pro" }
```

### 200

Returns the same shape as `GET /clubs/{cid}/plan` reflecting the new state.

### Errors

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_plan` | not one of `'starter' \| 'pro'` |
| 403 | `forbidden` | caller isn't a superadmin |
| 404 | `not_found` | club_id doesn't exist |

---

## 6. Public hydrate inclusion

Both `GET /public/clubs/{slug}/site` and `GET /clubs/resolve` carry the plan at the club level — same place as `brand_primary`, `logo_url`, etc.

```jsonc
{
  "data": {
    "club": {
      "plan": "starter",
      "brand_primary": "#2563EB",
      ...
    }
  }
}
```

Why the public site cares: the venue-hire block, honour-board block, and tournament-entry block should all gracefully degrade to a "coming soon" state (or disappear entirely) when the club isn't on Pro. Phase 1 doesn't ship those block-level gates — the FE hydrate just reads `plan` and the follow-up commits can pick it up with zero further backend work.

`/clubs/resolve` needs the plan too for the CRM's SSR path — `useClub()` reads from the tenant-resolve context, and the sidebar filtering runs on first paint.

---

## 7. FE wiring (for context — not asking you to do this)

Lands as a separate commit after the endpoint ships:

```ts
// apps/crm/src/composables/useFeature.ts
import { useClubStore } from '@/stores/club'
const PLAN_FEATURES = { starter: [...], pro: [...] }  // mirror of the server list

export function useFeature(key: FeatureKey): ComputedRef<boolean> {
  const store = useClubStore()
  return computed(() => {
    const plan = store.current?.plan ?? 'starter'
    return PLAN_FEATURES[plan].includes(key)
  })
}
```

Usage:
- Sidebar items: `v-if="hasFeature('venue_bookings')"` on each nav entry.
- Router guards: `beforeEnter: (to) => hasFeature(to.meta.feature) || next({ name: 'upgrade-nudge' })`.
- Blocks on the public site: check `site.value?.club?.plan` and render a "coming soon" state for Pro-only blocks on Starter clubs.

A shared `/upgrade` page in the CRM with a "You're on Starter. Pro unlocks …" card + a CTA (dead link until phase 2).

---

## 8. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Fetch a club's plan (defaults to starter).
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/plan"
# → 200 { data: { plan: 'starter', features: [...], is_pro: false } }

# 2. Superadmin flips to Pro.
curl -X PATCH -H "Authorization: Bearer $SUPERADMIN_JWT" "$API/clubs/5/plan" \
  -d '{"plan": "pro"}'
# → 200 { data: { plan: 'pro', is_pro: true } }

# 3. Non-superadmin can't flip.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/plan" \
  -d '{"plan": "pro"}'
# → 403 { code: 'forbidden' }

# 4. Bad plan value.
curl -X PATCH -H "Authorization: Bearer $SUPERADMIN_JWT" "$API/clubs/5/plan" \
  -d '{"plan": "enterprise"}'
# → 400 { code: 'bad_plan' }

# 5. Public hydrate carries the plan.
curl "$API/public/clubs/nae-nae-bowling-club/site" | jq '.data.club.plan'
# → "pro"

# 6. Tenant-resolve carries the plan.
curl "$API/clubs/resolve?host=nae-nae-bowling-club.torny.co" | jq '.data.plan'
# → "pro"
```

### Pass criteria

- ✓ `clubs.plan` column exists with DEFAULT `'starter'`.
- ✓ `GET /clubs/{cid}/plan` returns the full shape + allowlist.
- ✓ `PATCH /clubs/{cid}/plan` flips the value; rejects non-superadmins with 403.
- ✓ Invalid plan value 400s with `bad_plan`.
- ✓ Both public hydrate endpoints carry `plan` under the club payload.
- ✓ Smoke from the FE: superadmin flips a club to Pro → Pro-only sidebar items appear on next hydrate.

---

## 9. Non-goals

- **No Stripe subscription wiring.** Phase 2 (brief 87). This brief's PATCH is purely a manual override.
- **No public pricing page or signup flow.** Phase 3 (brief 88).
- **No in-app upgrade / downgrade UX.** Phase 4 (brief 89).
- **No per-feature "pay-as-you-go" purchases.** Starter + Pro, nothing in between.
- **No trial period.** Comes with billing in phase 2.
- **No annual billing discount.** Same — later.
- **No enforcement on existing data.** Starter clubs that previously had Pro features (via phase-0 access) will see those items disappear from the sidebar once this ships. Phase 2's migration + admin-nudge will walk them through a "you need to upgrade to keep using these" flow before any data is removed. No data deleted either way.
- **No per-user role tier.** The plan is per-club; every member of a Pro club gets Pro access.

---

## 10. Contact

Phase 1 is deliberately scoped to unblock the mental model + gating UX before any billing infra lands. Ping Felicity once the endpoints are live — FE wiring is a single commit on top. Phase 2 (Stripe subs) builds on this foundation; the sooner this ships, the sooner we can start layering the payment flow on top without an overlap.

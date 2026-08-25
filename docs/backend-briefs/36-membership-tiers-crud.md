# Membership Tiers — CRUD + club-level pricing settings

**Feature:** authed endpoints so club owners can add, edit, reorder, delete, and set default membership tiers from the **CRM Settings → Membership types** surface after onboarding is complete. Plus a small club-level PATCH for cadence + first-year discount (currently trapped in the onboarding blob).

**Related:** existing `GET /clubs/:club_id/membership-tiers` (already shipped — read-only), `PATCH /clubs/:club_id/onboarding` (wizard-only — writes to the same `membership_tiers` table but the autosave watch gates on `!completed`, so it's dead post-onboarding). Structural twin of brief 28 (honour-board CRUD) and brief 29 (events CRUD).

**Status:** requested. Settings page's Membership types tab currently reads through the onboarding blob and any edits are client-side only.

---

## TL;DR

1. **Four endpoints for tiers** under `/clubs/:club_id/membership-tiers` — create, update, delete, set-default. Read already exists.
2. **One club-level endpoint** `PATCH /clubs/:club_id/membership-settings` for the cadence + first-year discount toggle that sits above the tiers list in the UI.
3. **Extend the existing read shape** with `description` and `sort_order` fields so the settings page can show the tier blurb and preserve the display order.
4. **Auth:** owner or admin.
5. **Default invariant:** exactly one tier is `is_default = 1` per club. Backend flips the previous default to `0` atomically when a new one is picked.

---

## Base URL

Same CRM stack as the rest of the club endpoints:

```ts
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
```

Bearer JWT (owner or admin). No public read for these — the `/site.membership_tiers` payload is the public surface and already exists.

---

## 1. Data model additions

Existing `membership_tiers` table extended:

```sql
ALTER TABLE membership_tiers
  ADD COLUMN description TEXT NULL,
  ADD COLUMN tone VARCHAR(24) NULL,          -- 'accent' | 'mint' | 'tangerine' | 'violet' | custom
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
```

Nothing else changes on the tier row itself.

Also — cadence and first-year discount are **club-level** settings, not per-tier. Backend probably stores these on `clubs` today (they arrive via `PATCH /clubs/:id/onboarding` as `cadence` + `first_year_discount`). Confirm they're columns, not JSON blob — the settings endpoint below assumes columns.

---

## 2. Extended read shape

`GET /clubs/:club_id/membership-tiers` — same endpoint, richer response:

```json
{
  "status": "success",
  "data": {
    "tiers": [
      {
        "id": 12,
        "type_name": "Playing member",
        "type_code": "playing",
        "slug": "playing-member",
        "description": "Full playing rights, all comps, unlimited rink bookings.",
        "cadence": "annual",
        "fee": 220,
        "tone": "accent",
        "sort_order": 0,
        "is_default": true
      }
    ],
    "settings": {
      "cadence": "monthly",
      "first_year_discount": true
    }
  }
}
```

**New fields on each tier:** `description` (≤ 500 chars, nullable), `tone` (free string, nullable — client-side hint used to colour the card border), `sort_order` (ascending — 0 sorts first).

**New `settings` block on the envelope:** the club-level `cadence` + `first_year_discount`. Keeps the settings page's single fetch flat — no follow-up to `GET /clubs/:id/onboarding` post-onboarding.

The existing per-tier `cadence` column stays too (each tier can override the club default cadence if the club runs mixed billing — probably rare, but the data model already supports it).

---

## 3. `POST /clubs/:club_id/membership-tiers`  (🔒 admin+)

Create a tier.

**Body:**

```json
{
  "type_name": "Playing member",
  "type_code": "playing",
  "description": "Full playing rights, all comps.",
  "cadence": "annual",
  "fee": 220,
  "tone": "accent",
  "sort_order": 0,
  "is_default": false
}
```

- `type_name` — required, 1..80 chars.
- `type_code` — optional, kebab-lowercase, ≤ 32 chars. Auto-derived from name if omitted.
- `slug` — server-generated from `type_name`, unique per club. Owner never touches it.
- `description` — optional, ≤ 500 chars.
- `cadence` — one of `annual | monthly | season`, defaults to the club's `settings.cadence`.
- `fee` — non-negative int (dollars, no cents for now — the UI already treats it as a whole number).
- `tone` — optional free string; client uses this for the coloured card border.
- `sort_order` — optional. If omitted, backend appends at `MAX(sort_order) + 1`.
- `is_default` — optional, defaults false. If true, backend flips any existing default to false in the same transaction.

**201 Success:** returns the created row in the same shape as the read response.

**Errors:**

| Case | HTTP | code |
|---|---|---|
| Missing / bad `type_name` | 400 | `bad_type_name` |
| Slug collision | 400 | `slug_conflict` |
| Unknown `cadence` value | 400 | `bad_cadence` |
| Negative `fee` | 400 | `bad_fee` |
| Not admin+ | 403 | — |

---

## 4. `PATCH /clubs/:club_id/membership-tiers/:tier_id`  (🔒 admin+)

Partial update. All fields optional.

**Body:** any subset of the create body (`type_name`, `description`, `cadence`, `fee`, `tone`, `sort_order`, `is_default`).

**Special handling for `is_default: true`:** backend flips the previous default to false in the same transaction. Setting `is_default: false` on the current default is allowed but leaves the club with **no** default — recommend returning 400 `default_required` if the caller tries to demote the last default without promoting another.

**200 Success:** returns the updated row.

**Errors:** same table as create + `404 not_found` when the tier doesn't exist or belongs to another club.

---

## 5. `DELETE /clubs/:club_id/membership-tiers/:tier_id`  (🔒 admin+)

Hard delete.

**Guardrails:**

- 400 `default_tier` if the target is `is_default = 1`. Owner has to promote another tier first.
- 400 `last_tier` if this is the only tier for the club. Every club needs at least one tier to accept members.
- 400 `tier_in_use` if any `club_members` row currently references this tier — probably too aggressive; alternatively, backend could reassign those to the default. **Owner's call** — flag if you want the reassign behaviour instead.

**200 Success:** `{ status: 'success', message: 'Tier deleted' }`. Cascade on FK for anything downstream.

---

## 6. `POST /clubs/:club_id/membership-tiers/:tier_id/set-default`  (🔒 admin+)

Convenience endpoint to atomically flip the default. Equivalent to `PATCH /tier_id { is_default: true }` but with a clearer name for the CRM's "Make default" link.

**200 Success:** returns the freshly-promoted tier.

---

## 7. `PATCH /clubs/:club_id/membership-settings`  (🔒 admin+)

Club-level cadence + first-year discount.

**Body:**

```json
{
  "cadence": "annual",
  "first_year_discount": true
}
```

Both fields optional. Sending `null` for `first_year_discount` clears it (defaults to false). `cadence` on the club is the default for new tiers — existing tiers keep their per-row cadence unless the owner PATCHes them individually.

**200 Success:** echoes the two fields.

**Errors:** `400 bad_cadence` on unknown value.

---

## 8. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/members.ts`** — extend `MembershipTierListItem` with `description` / `tone` / `sort_order`. Add `createTier`, `updateTier`, `deleteTier`, `setDefaultTier`, `updateSettings`.
- **Settings page (`apps/crm/src/views/settings/SettingsView.vue`)** — replace the current onboarding-blob reads with a dedicated `useMembershipTiersStore` that fetches on mount, mutates via the new endpoints, refreshes after each save.
- **Onboarding wizard** stays as-is — the wizard's Step 4 still writes tiers via `PATCH /clubs/:id/onboarding`. Once complete, the settings page takes over via the new endpoints. Both surfaces target the same `membership_tiers` table so a tier created in the wizard is editable in Settings without any migration.

---

## 9. Verification

Same lifecycle format as prior briefs — please run and confirm:

| Step | Expected |
|---|---|
| `POST /clubs/5/membership-tiers` with a full body | 201, new row, `sort_order = MAX + 1` |
| `POST` with `is_default: true` on a club that already has a default | Old default flips to `false` atomically |
| `PATCH /clubs/5/membership-tiers/12 { fee: 240 }` | 200, updated |
| `PATCH … { is_default: true }` | Previous default demoted |
| `PATCH … { is_default: false }` on the sole default | 400 `default_required` |
| `POST /clubs/5/membership-tiers/12/set-default` | 200, target now default |
| `DELETE` a non-default tier with no linked members | 200 |
| `DELETE` the current default | 400 `default_tier` |
| `DELETE` the last tier | 400 `last_tier` |
| `PATCH /clubs/5/membership-settings { cadence: 'monthly' }` | 200, echoes new settings |
| `GET /clubs/5/membership-tiers` after all the above | Returns `tiers[]` + `settings` block |
| `/site.membership_tiers` public payload picks up the changes | ✓ (existing revalidate webhook fires) |

---

## 10. Non-goals

- **No per-tier custom cadence UI yet** — the settings page uses one club-level cadence for all tiers. The `cadence` column on the tier row is kept in the data model for future flexibility but the CRM writes the same value to every tier when the club-level toggle flips (or just leaves per-tier values alone if the backend prefers).
- **No monthly-billing plumbing.** The `cadence` is a display setting only for now (public site shows "$220 / year" etc). Stripe billing on cadence is a much bigger arc.
- **No tier archival with undo.** Hard delete matches the wizard's behaviour. If owners ask for a "restore recently deleted tier", we'll add `deleted_at` later.
- **No CSV export / import.** Manual only.
- **No changing `type_code`** after create — it feeds `member` records and slugs, so backend can 400 `type_code_locked` if you want, or silently ignore the field on PATCH.

---

## 11. Open questions

1. **`tier_in_use` on DELETE** — 400 (owner has to migrate first) or auto-reassign to default? Recommend the former for MVP — safer, no data movement.
2. **`type_code` on PATCH** — silently ignore, or 400? Recommend ignore (matches how brief 27 handles page slugs on PATCH).
3. **Default cadence override** — when a club-level cadence changes, should existing tiers with a matching cadence rebase to `null` (inherit) or stay pinned? Recommend stay pinned; the per-tier cadence takes precedence if set.

---

## 12. Contact

`#torny-eng`. One-liner change on the shape (add three columns), plus the five endpoints. Should be a quick shift alongside brief 30's post-onboarding cleanup.

# Add `headerSticky` to the public `/site` response

**Feature:** the sticky-header toggle in the CRM Website → Navigation panel persists to the DB (via `PATCH /clubs/:cid/navigation`) but doesn't come back out in the public `/public/clubs/:slug/site` payload. Public sites always render with `sticky: false` because that's what the Nuxt layout reads from the missing field.

**Status:** backend not started. Repros today — toggle on in the CRM, saved toast appears, refresh the public site: header still scrolls away. The flag never leaves the DB.

**Related briefs:**
- brief 25 (site payload / navigation) — the owning brief; needs the one-field extension.
- brief 15 / 16 (site chrome) — explains how the Nuxt layout consumes the field (`site.club.navigation.headerSticky`).

---

## 1. What's happening

The write path works end-to-end:

```
PATCH /clubs/42/navigation   { headerSticky: true }
← 200  { headerSticky: true, header: [...], footer: [...] }
```

But the read path omits the field:

```
GET /public/clubs/naenae-bowling/site
← 200  {
    data: {
      club: {
        navigation: {
          header: [...],
          footer: [...]
          // headerSticky missing
        }
      }
    }
  }
```

Nuxt layout reads it defensively:
```js
const headerSticky = computed(() =>
  Boolean(site.value?.club?.navigation?.headerSticky)
)
```

Missing field → `undefined` → `Boolean()` → `false`. SiteHeader never gets `:sticky="true"` and the `.site-header--sticky` class is never applied. User's toggle has no effect on the live site.

---

## 2. The fix

Add `header_sticky` (or whatever the DB column is called) to the serializer that builds `club.navigation` in the `/public/clubs/:slug/site` response. The field already exists on the row — only its exposure in the public read endpoint is missing.

Response shape after fix:

```jsonc
{
  "data": {
    "club": {
      "navigation": {
        "header": [...],
        "footer": [...],
        "headerSticky": true    // ← add
      }
    }
  }
}
```

Field name on the FE is **camelCase `headerSticky`** to match the PATCH response. If the DB column is `header_sticky`, map it in the serializer.

Default when the row has never been touched: `false`. Admins have to explicitly opt in.

---

## 3. Cache invalidation

The club's `/site` payload is cached on the Nuxt side (5-min SWR per `nuxt.config.ts`) and on the Cloudflare edge. If the backend already fires the Nuxt `/api/revalidate` webhook on nav saves (per brief 25 §cache invalidation), nothing more is needed — the admin sees the change within ~10 seconds. If it doesn't, add `navigation` to the kinds that trigger a revalidate.

Quick confirmation: a PATCH to `/clubs/:cid/navigation` should trigger the same revalidate signal that saving a page layout triggers. If not, that's a one-line add in the save handler.

---

## 4. Scope not included

- Changing the toggle UI or the PATCH endpoint — both already correct.
- Changing the FE handling — `Boolean(site?.club?.navigation?.headerSticky)` degrades to `false` safely if the field stays missing, so no FE change is needed before or after the backend ship.
- Adding other missing nav fields — none that we know of. If the audit finds any, flag them.

---

## 5. Open questions

1. **Is this the only public-read field missing from brief 25's spec?** Worth a cross-check against the FE's `SiteNavigation` type (`apps/club-sites/server/utils/tornyApi.ts:76`) which lists the fields the frontend actually consumes.
2. **Does the nav PATCH already fire the revalidate webhook?** If yes, nothing to do on the cache side. If no, add it.

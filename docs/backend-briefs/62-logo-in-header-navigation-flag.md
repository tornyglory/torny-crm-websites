# Add `logoInHeader` to the navigation PATCH + /site response

**Feature:** admins can toggle "use the uploaded logo in place of the club name text" from the CRM Website → Brand tab. The flag persists via the existing `PATCH /clubs/:cid/navigation` endpoint, and needs to be echoed back out through `GET /public/clubs/:slug/site` so the public site renderer sees it.

**Status:** backend not started. FE is wired and ready — the toggle writes `logoInHeader: boolean` to the navigation PATCH payload and the Nuxt layout reads `site.club.navigation.logoInHeader` to pass through to `<SiteHeader :logo-only="…">`. Until the backend lands, the toggle appears to save but has no effect on the public site, same as the sticky flag before brief 61.

**Related briefs:**
- brief 25 (navigation) — the owning brief; this is a second one-field extension on top.
- brief 61 (headerSticky) — identical shape and ask. This is a parallel field, same wiring.

---

## 1. The ask

Two one-line additions, both in handlers that already exist:

### 1a. `PATCH /clubs/:cid/navigation` — accept + persist + echo

Add `logo_in_header` to the accepted body (camelCase on the wire — `logoInHeader` — but a `logo_in_header` DB column makes sense). Default `false` on insert.

**Request** (FE sends it like this today):

```jsonc
PATCH /clubs/42/navigation
{
  "header": [...],
  "footer": [...],
  "headerSticky": true,
  "logoInHeader": true    // NEW — accept + persist
}
```

**Response** — echo it back alongside the existing fields:

```jsonc
{
  "data": {
    "clubId": 42,
    "header": [...],
    "footer": [...],
    "headerSticky": true,
    "logoInHeader": true   // NEW
  }
}
```

### 1b. `GET /public/clubs/:slug/site` — include it

Add `logoInHeader` to the `club.navigation` block in the public site payload:

```jsonc
{
  "data": {
    "club": {
      "navigation": {
        "header": [...],
        "footer": [...],
        "headerSticky": false,
        "logoInHeader": true   // NEW
      }
    }
  }
}
```

Default when the column was never touched: `false`.

---

## 2. Cache invalidation

Same pattern as brief 61 — the navigation PATCH should fire the Nuxt revalidate webhook so admins see the change on the public site within ~10s. If brief 61's audit confirmed the webhook is already wired on navigation saves, nothing else to do here. If not, add it in the same handler.

---

## 3. Why only one new field

The alternative was adding a separate `headerBrandMode: 'name' | 'logo'` enum, but a boolean is simpler and mirrors `headerSticky`. If a third mode ever lands (e.g. "name only, no logo mark"), we promote to an enum in a follow-up — no admin will have anything else than true/false stored by then.

The field only has visual effect when `club.logo_url` is non-null. The FE already treats "logoInHeader on, no logo uploaded" as a no-op (toggle is disabled in the admin UI). Backend doesn't need to enforce this coupling — it's purely display logic.

---

## 4. Scope not included

- Changing the brand-asset upload path — not touched. Admins continue to upload logos the same way they do today.
- Changing the SiteHeader component's rendering — already handled on the FE.
- Any brand-tab validation — `logoInHeader` is just a bool, no server validation beyond the type.

---

## 5. Open questions

1. **Field name** — I used `logoInHeader` on the wire. If `headerBrandLogo` reads better in the backend DB column naming scheme, happy to adjust on the FE too; low cost. Just need the final name confirmed before deploy.
2. **Audit for siblings** — brief 61 flagged auditing the FE `SiteNavigation` type for other missing fields. `logoInHeader` is the only new one from this release; the rest of the type (`header`, `footer`, `headerSticky`) is already covered.

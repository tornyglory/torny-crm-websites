# Navigation: header display mode + custom header name

**Feature:** let admins control what shows in the public site header (logo only / name only / both) and override the name that renders there (defaults to `club.name`). Two tiny fields on the existing navigation payload. Supersedes the binary `logo_in_header` boolean from brief 62.

**Status:** FE wired through to the CRM Brand tab. Backend owes two columns + two fields on the existing navigation endpoint. The FE falls back to the old `logo_in_header` boolean when the new `header_display` enum is absent, so this is backward-compatible — nothing breaks if the backend ships behind the FE.

**Related:**
- Brief 25 — original navigation endpoint (`PATCH /clubs/{cid}/navigation`).
- Brief 62 — `logo_in_header` boolean (the thing this supersedes).
- Brief 79 — same pattern as the image-style add: enum field on an existing brand payload.

---

## TL;DR

1. Add two columns to the row that stores navigation (likely `clubs_data` or a dedicated `club_navigation` table — whichever currently holds `logo_in_header`):
   - `header_name VARCHAR(80) NULL` — null = use `clubs.name`.
   - `header_display ENUM('logo','name','both') NOT NULL DEFAULT 'name'`.
2. Extend `PATCH /clubs/{cid}/navigation` to accept + echo both.
3. Include both in the public club hydrate (the endpoint that already carries `navigation.header`, `navigation.footer`, `logo_in_header`).
4. Backfill `header_display` from the existing `logo_in_header` value: `true → 'logo'`, `false → 'name'`.

Keep `logo_in_header` on the payload for one release so old clients don't break; remove it in a follow-up once every FE build has rolled over.

---

## 1. Schema

```sql
-- Wherever logo_in_header currently lives (clubs_data or club_navigation):
ALTER TABLE <that_table>
  ADD COLUMN header_name    VARCHAR(80) NULL,
  ADD COLUMN header_display ENUM('logo','name','both') NOT NULL DEFAULT 'name';

-- Backfill: preserve existing logo_in_header behavior exactly.
UPDATE <that_table>
   SET header_display = CASE
     WHEN logo_in_header = 1 THEN 'logo'
     ELSE 'name'
   END;
```

`header_name` is nullable because "use the canonical club name" is the normal case. Admins who want to display a shortened or styled version (e.g. "Kelburn" instead of "Kelburn Bowling Club Inc.") set it; everyone else leaves it `NULL`.

---

## 2. `PATCH /clubs/{cid}/navigation`

### Request — add two optional fields

```jsonc
{
  "header":        [ ... ],                       // existing
  "footer":        [ ... ],                       // existing
  "headerSticky":  true,                           // existing
  "logoInHeader":  false,                          // existing — accept + echo for one release
  "headerName":    "Kelburn",                      // NEW — null/missing accepted
  "headerDisplay": "both"                          // NEW — 'logo' | 'name' | 'both'
}
```

Rules:
- `headerName` — present = set, missing = no-op, `null` = clear (fall back to `clubs.name`). Max 80 chars; trim whitespace; reject empty string with 400 `bad_header_name` (use `null` to clear).
- `headerDisplay` — present = set, missing = no-op. `null` is **not** valid (there's no "clear" state — only the three enum values).

### 400 on invalid value

```jsonc
{ "status": "error", "code": "bad_header_display", "message": "header_display must be one of: logo, name, both" }
```
```jsonc
{ "status": "error", "code": "bad_header_name", "message": "header_name must be 1–80 characters, or null to clear" }
```

### ⚠️ Relax the "at least one of header / footer / headerSticky" validator

Confirmed in prod — brief 25's endpoint rejects a PATCH body that contains only `headerName` + `headerDisplay` with 400 "at least one of header, footer or headerSticky is required". Update the check to accept the new fields too:

> At least one of `header`, `footer`, `headerSticky`, `logoInHeader`, `headerName`, or `headerDisplay` must be present.

Until this ships, the FE sends the current `headerSticky` alongside every header-display/name change as a no-op workaround (see the FE commit trailing this brief). Shipping the validator change removes the workaround.

### 200 response — echo includes both new fields

```jsonc
{
  "status": "success",
  "data": {
    "clubId":        5,
    "header":        [ ... ],
    "footer":        [ ... ],
    "headerSticky":  true,
    "logoInHeader":  false,
    "headerName":    "Kelburn",
    "headerDisplay": "both"
  }
}
```

### Interaction with the old `logo_in_header` boolean

- A PATCH that only sets `headerDisplay` should also sync `logo_in_header` to the derived boolean (`display === 'logo'`) so old clients keep working for the overlap release.
- A PATCH that only sets `logoInHeader` should also sync `headerDisplay` the inverse way (`true → 'logo'`, `false → 'name'`).
- Admin sets both in the same PATCH → `headerDisplay` wins; `logo_in_header` is derived to match.

---

## 3. Public club hydrate

Add `header_name` + `header_display` to the hydrate payload (the endpoint that feeds the Nuxt `useSite()` composable — same place `logo_in_header` lives today).

If either field is absent, the FE falls back:
- `header_name` missing or `null` → use `club.name`.
- `header_display` missing → derive from `logo_in_header` (`true → 'logo'`, `false → 'name'`).

Soft rollout — ship the columns + PATCH acceptance first, add to hydrate second, no FE coordination needed.

---

## 4. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set display mode + custom name.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerDisplay":"both","headerName":"Kelburn"}'
# → 200 { data: { headerDisplay: 'both', headerName: 'Kelburn', logoInHeader: false, ... } }

# 2. Clear the custom name — falls back to clubs.name.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerName":null}'
# → 200 { data: { headerName: null, ... } }

# 3. Invalid enum.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerDisplay":"nothing"}'
# → 400 { code: 'bad_header_display' }

# 4. Empty string rejected (use null to clear).
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerName":"   "}'
# → 400 { code: 'bad_header_name' }

# 5. Old client still works — setting logoInHeader derives headerDisplay.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"logoInHeader":true}'
# → 200 { data: { logoInHeader: true, headerDisplay: 'logo', ... } }

# 6. Public hydrate includes both.
curl "$API/public/clubs/kelburn-bowls/site"
# → 200 { ..., navigation: { header_name: 'Kelburn', header_display: 'both', logo_in_header: false, ... } }
```

**Pass criteria:**
- ✓ Columns added; existing rows backfilled from `logo_in_header`.
- ✓ PATCH accepts both new fields and echoes them.
- ✓ Invalid enum 400s with `bad_header_display`.
- ✓ Empty / whitespace `header_name` 400s with `bad_header_name`; `null` clears cleanly.
- ✓ Setting one of `headerDisplay` / `logoInHeader` syncs the other for backward-compat.
- ✓ Public hydrate carries both fields.

---

## 5. Non-goals

- **No per-page override.** One header per club, applied site-wide.
- **No deprecation of `logo_in_header` in this brief.** Keep it on the payload for one release. Removing it is a follow-up once every published FE build has rolled over.
- **No subtitle / strapline.** The `SiteChromeClub.strapline` field exists on the FE types but isn't wired to a column yet. That's a separate feature.
- **No logo variant per display mode** (e.g. "use the horizontal lockup when `display='both'`"). One logo image, one header name; FE handles layout.

---

## 6. Contact

Ping Felicity once the columns + PATCH acceptance are deployed. FE picker starts saving immediately; hydrate addition can follow in a second PR with zero FE coordination.

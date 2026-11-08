# Navigation: header display mode + custom header name

**Feature:** let admins control what shows in the public site header (logo only / name only / both) and override the name that renders there (defaults to `clubs_data.name`). Two tiny fields on the existing navigation payload. Supersedes the binary `logoInHeader` boolean that the FE used to send (never stored server-side).

**Status:** FE wired through to the CRM Brand tab. Backend owes the columns + the two-field addition to `/clubs/{cid}/navigation`. The FE falls back to the old `logoInHeader` boolean when the new `headerDisplay` enum is absent, so this is backward-compatible — nothing breaks if the backend ships behind the FE.

**Related:**
- Brief 25 — original navigation endpoint (`PATCH /clubs/{cid}/navigation`).
- Brief 62 — `logoInHeader` boolean (the thing this supersedes). Never landed as a backend column — was always a FE-only field.
- Brief 79 — same pattern as the image-style add: enum field on an existing brand payload.

---

## TL;DR

- Two new columns on `clubs_data`:
  - `header_name VARCHAR(80) NULL` — null = use `clubs_data.name`.
  - `header_display ENUM('logo','name','both') NOT NULL DEFAULT 'name'`.
- `PATCH /clubs/{cid}/navigation` now accepts + echoes both.
- Public hydrate (`GET /public/clubs/{slug}/site`) returns both under `data.club.navigation`.
- `logoInHeader` is **not** a stored column — it's a derived alias (`header_display === 'logo'`). The endpoint accepts it as input (maps to `header_display`) and emits it in the response for one release so old FE builds keep working.
- No backfill needed: all existing rows default to `header_display='name'` (historical behaviour of showing the club name text).

---

## 1. Schema

Live. Migration 146:

```sql
ALTER TABLE clubs_data
  ADD COLUMN header_name    VARCHAR(80) NULL,
  ADD COLUMN header_display ENUM('logo','name','both') NOT NULL DEFAULT 'name';
```

All 1,461 existing rows get `header_display='name'` via the column DEFAULT. `header_name` stays NULL until an admin opts in to a custom display name.

Note: `logo_in_header` was **never a backend column** — the brief's earlier assumption that it was is off. On the FE it was a boolean that lived on the response payload but was never persisted. This brief doesn't backfill from it because there's nothing to backfill from.

---

## 2. `PATCH /clubs/{cid}/navigation`

### Request — add two optional fields

```jsonc
{
  "header":        [ ... ],                       // existing — nav list
  "footer":        [ ... ],                       // existing — nav list
  "headerSticky":  true,                           // existing
  "logoInHeader":  false,                          // LEGACY — accepted + echoed for one release
  "headerName":    "Kelburn",                      // NEW — null/missing accepted
  "headerDisplay": "both"                          // NEW — 'logo' | 'name' | 'both'
}
```

Rules:

- `headerName` — present = set, missing = no-op, null = clear (fall back to `clubs_data.name`). Max 80 chars; trimmed server-side; empty / whitespace rejected with 400 `bad_header_name` (use `null` to clear).
- `headerDisplay` — present = set, missing = no-op. `null` is **not** valid (there's no "clear" state — only the three enum values).
- `logoInHeader` — still accepted. If sent **without** `headerDisplay`, it derives `headerDisplay` (true → `'logo'`, false → `'name'`). If both are in the same PATCH, `headerDisplay` wins and `logoInHeader` is ignored for the write.

### 400 on invalid value

```jsonc
{ "status": "error", "code": "bad_header_display", "message": "header_display must be one of: logo, name, both" }
{ "status": "error", "code": "bad_header_name",    "message": "header_name must be 1–80 characters, or null to clear" }
```

### "At least one of" validator — relaxed

Pre-change the endpoint bounced with 400 `bad_json` / `"at least one of header, footer or headerSticky is required"` when the body was empty of recognised fields. The check now accepts any of:

`header`, `footer`, `headerSticky`, `logoInHeader`, `headerName`, or `headerDisplay`.

So a PATCH that only sets `headerDisplay` is a valid call — no need to padding `headerSticky` alongside it any more.

### 200 response — echoes everything

```jsonc
{
  "status": "success",
  "data": {
    "clubId":        5,
    "header":        [ ... ],
    "footer":        [ ... ],
    "headerSticky":  true,
    "headerName":    "Kelburn",
    "headerDisplay": "both",
    "logoInHeader":  false   // derived from headerDisplay — kept one release
  }
}
```

`logoInHeader` in the response is `headerDisplay === 'logo'`. Old FE builds that read `logoInHeader` keep working; new FE builds should read `headerDisplay` directly and treat `logoInHeader` as deprecated.

---

## 3. Public club hydrate

`GET /public/clubs/{slug}/site` (TornyCrmStack) returns both new fields under `data.club.navigation`:

```jsonc
{
  "data": {
    "club": {
      "navigation": {
        "header":          [ ... ],
        "footer":          [ ... ],
        "headerSticky":    true,
        "header_name":     "Kelburn",
        "header_display":  "both",
        "logo_in_header":  false
      }
    }
  }
}
```

FE fallback behaviour (unchanged, in case the hydrate deploys later than the FE):

- `header_name` missing or null → use `club.name`.
- `header_display` missing → derive from `logo_in_header` (true → `'logo'`, false → `'name'`).

---

## 4. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set display mode + custom name.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerDisplay":"both","headerName":"Kelburn"}'
# → 200 { data: { headerDisplay: 'both', headerName: 'Kelburn', logoInHeader: false, ... } }

# 2. Clear the custom name — falls back to clubs_data.name.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerName":null}'
# → 200 { data: { headerName: null, ... } }

# 3. Invalid enum.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerDisplay":"nothing"}'
# → 400 { code: 'bad_header_display' }

# 4. Empty / whitespace rejected (use null to clear).
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"headerName":"   "}'
# → 400 { code: 'bad_header_name' }

# 5. Old client still works — setting logoInHeader derives headerDisplay.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" \
  -d '{"logoInHeader":true}'
# → 200 { data: { logoInHeader: true, headerDisplay: 'logo', ... } }

# 6. Public hydrate includes both.
curl "$API/public/clubs/nae-nae-bowling-club/site"
# → 200 { data: { club: { navigation: { header_name, header_display, logo_in_header, ... } } } }

# 7. Empty body → 400 with the new "at least one of" message.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/navigation" -d '{}'
# → 400 { code: 'bad_json', message: "at least one of header, footer, headerSticky, logoInHeader, headerName or headerDisplay is required" }
```

Pass criteria:
- ✓ Columns added; existing rows carry the `'name'` default; `header_name` null everywhere.
- ✓ PATCH accepts both new fields and echoes them.
- ✓ Invalid enum 400s with `bad_header_display`.
- ✓ Empty / whitespace `header_name` 400s with `bad_header_name`; null clears cleanly.
- ✓ Sending one of `headerDisplay` / `logoInHeader` syncs the response correctly.
- ✓ Public hydrate carries both new fields plus `logo_in_header` alias.
- ✓ Empty-body error message now lists all six acceptable keys.

---

## 5. Non-goals

- **No per-page override.** One header per club, applied site-wide.
- **No full deprecation of `logoInHeader` in this brief.** Kept on the payload (both PATCH echo and public hydrate) for one release. Removing it is a follow-up once every published FE build has rolled over.
- **No subtitle / strapline.** The `SiteChromeClub.strapline` field exists on the FE types but isn't wired to a column yet. Separate feature.
- **No logo variant per display mode.** One logo image, one header name; FE handles layout.

# Brief 107 — Retire the hardcoded `your_bowls` section + unblock section-label overrides

**Scope:**
- API (VenueStack): drop `your_bowls` from the `club` vertical's `join_form_sections` in the variant registry; make `bowls` optional on the `POST /public/clubs/{slug}/membership-applications` payload; (prereq) ship the `PATCH /clubs/{id}/join-form-config` endpoint from Brief 106 §3.
- CRM FE / club-sites: no code changes required for the `your_bowls` retirement (already shipped — commits `483ee9e` + the follow-up legacy-key filter). FE will stop surfacing `your_bowls` in the Join form editor modal + the public form automatically.

**Prereq:** Brief 106 shipped on the FE. The API work in §3 of Brief 106 is still outstanding; Brief 107 bundles it with the Your-bowls retirement because both are needed to close the loop.

> **Backend status (2026-11-13):** Brief 105 variant endpoint live. Brief 106 FE modal + Option A FE cleanup live (`main` as of `483ee9e`). This brief covers what's needed on the backend to make everything green end-to-end.

---

## 1. The ask

Three contained changes, each independent:

1. **Remove `your_bowls` from the `club` vertical's `join_form_sections`** in the variant registry. (CRM FE is already filtering this key client-side as a safety net — but we don't want a legacy section leaking into the public variant forever.)
2. **Make `bowls` optional on the application-submit payload.** The FE still sends a zero-shaped `bowls` block today so the current schema doesn't 400; we'd like to drop it cleanly once backend accepts the omission.
3. **Ship the `PATCH /clubs/{id}/join-form-config` endpoint and overrides column** from Brief 106 §3. The CRM Join form editor modal is already built against this endpoint — a Save that touches section visibility / order / `label_override` currently hits 404 and the FE surfaces a friendly "coming soon" message.

---

## 2. Why

- **Vertical neutrality.** `your_bowls` was bowls-specific. Non-bowls verticals (rentals, nursing, pro associations) shouldn't ever see a section called "Your bowls" land in their variant. Admins who want experience / position / playing-days capture add them as custom facets under Additional questions.
- **Clean payload.** FE currently ships `bowls: { experience: 'never', bowls_number: null, position: 'no_preference', playing_days: [] }` purely so the schema passes. Backward-compat for historical applications is fine (the `bowls` column stays on the table and old rows keep their data); new submissions just omit the block.
- **Brief 106 closure.** The modal's Save button is live but its network call errors on 404 today. Shipping the endpoint unlocks the sections editing round-trip.

---

## 3. Variant registry change

Update the `club` vertical in the `get-club-variant` handler to drop `your_bowls`:

```json
"join_form_sections": [
    { "key": "tier",              "label": "Choose your tier" },
    { "key": "about_you",         "label": "About you" },
    { "key": "address",           "label": "Home address" },
    { "key": "emergency_contact", "label": "Emergency contact" },
    { "key": "additional",        "label": "Additional questions" },
    { "key": "review",            "label": "Review & agree" }
]
```

Public + authed variant responses both. No schema change — the list is static per-vertical.

### 3.1 Migration safety

- **Existing `clubs_data.join_form_overrides_json` rows** may reference `{ key: 'your_bowls' }`. Treat unknown keys as no-op when merging rather than 422ing — keeps the stored JSON valid without a cleanup pass. Alternatively run a one-shot UPDATE to strip `your_bowls` entries from the array.
- **No change to `applications` or `members` tables.** Historical `bowls` data stays on the rows; we're only changing what new applications submit and what `/variant` echoes back.

---

## 4. Application payload

Make the top-level `bowls` field optional on `POST /public/clubs/{slug}/membership-applications`:

```ts
// Before
interface CreateApplicationInput {
    tier_id: number | null
    bowls: ApplicationBowls   // required
    // ...
}

// After
interface CreateApplicationInput {
    tier_id: number | null
    bowls?: ApplicationBowls | null   // optional — default null
    // ...
}
```

- When `bowls` is omitted or `null`, store `NULL` in the `applications.bowls_json` column.
- Don't backfill historical rows.
- Validation: if `bowls` is present, apply the existing shape check; if absent, skip.
- Error code: no new codes needed. Existing `missing_required` stays pointed at name / email / dob / address / emergency / consent.

The CRM FE will drop the stubbed bowls block from its `CreateApplicationInput` payload in a follow-up commit once this ships.

---

## 5. `PATCH /clubs/{id}/join-form-config` (Brief 106 §3)

Brief 106 §3.1–§3.4 is the source of truth; summary for convenience:

```http
PATCH /clubs/{club_id}/join-form-config
Authorization: Bearer <owner JWT>
Content-Type: application/json

{
    "sections": [
        { "key": "tier",              "order": 0, "visible": true },
        { "key": "about_you",         "order": 1, "visible": true },
        { "key": "additional",        "order": 2, "visible": true,  "label_override": "Tell us more" },
        { "key": "address",           "order": 3, "visible": true },
        { "key": "emergency_contact", "order": 4, "visible": true },
        { "key": "review",            "order": 5, "visible": true }
    ]
}
```

- Validation + error codes match Brief 106 §3.4 (`unknown_section` / `bad_order` / `sections_required` / `forbidden` / `not_found`).
- Response merges overrides into the variant and returns the full `VariantConfig` so the FE doesn't need a follow-up GET.
- `label_override` is **critical** for the CRM UX we just shipped — the modal has a per-section label input that becomes live the moment this endpoint accepts it. Please support it on day one rather than deferring.

### 5.1 Schema (per Brief 106 §3.1)

```sql
ALTER TABLE clubs_data
    ADD COLUMN join_form_overrides_json JSON NULL AFTER vertical;
```

Shape of the JSON (persisted per Brief 106 §3.1):

```json
{
    "sections": [
        { "key": "tier",              "visible": true,  "order": 0, "label_override": null },
        { "key": "additional",        "visible": true,  "order": 2, "label_override": "Tell us more" }
    ]
}
```

Missing keys fall back to variant defaults; null column = no overrides at all.

---

## 6. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # owner JWT
CLUB=5

# 1. Variant no longer carries your_bowls
curl -s "$VENUE/clubs/$CLUB/variant" -H "Authorization: Bearer $TOKEN" \
    | jq '.data.join_form_sections[] | .key'
# → tier / about_you / address / emergency_contact / additional / review

# 2. Public variant too
curl -s "$VENUE/public/clubs/naenae-bowling-club/variant" \
    | jq '.data.join_form_sections[] | .key'
# → same list

# 3. Application submit without bowls
curl -s -X POST "$VENUE/public/clubs/naenae-bowling-club/membership-applications" \
    -H "Content-Type: application/json" \
    -d '{
        "tier_id": 7,
        "full_name": "Test applicant",
        "dob": "1990-01-01",
        "email": "test@example.com",
        "mobile": "+64211234567",
        "address": { "street": "1 Test St", "suburb": "Wellington", "postcode": "6011" },
        "emergency_contact": { "name": "Someone", "phone": "+64211111111" },
        "consent": { "terms": true }
    }' | jq
# → 200 { application_id, status: "pending" }

# 4. PATCH join-form-config (with label_override on additional)
curl -s -X PATCH "$VENUE/clubs/$CLUB/join-form-config" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{
        "sections": [
            {"key":"tier","order":0,"visible":true},
            {"key":"about_you","order":1,"visible":true},
            {"key":"additional","order":2,"visible":true,"label_override":"Tell us more"},
            {"key":"address","order":3,"visible":true},
            {"key":"emergency_contact","order":4,"visible":true},
            {"key":"review","order":5,"visible":true}
        ]
    }' | jq '.data.join_form_sections'
# → "additional" row shows label: "Tell us more"
```

---

## 7. Pass criteria

- ✓ `/variant` + `/public/clubs/{slug}/variant` return 6 sections (no `your_bowls`) for the `club` vertical.
- ✓ Existing overrides rows that still reference `your_bowls` are ignored gracefully (no 500, no 422).
- ✓ `POST /public/clubs/{slug}/membership-applications` succeeds without a `bowls` block in the payload.
- ✓ `PATCH /clubs/{id}/join-form-config` writes the overrides JSON, honours `label_override`, and returns the merged variant.
- ✓ Owner-only on the PATCH; members get a 403 / `forbidden`.
- ✓ CRM Join form editor modal's Save no longer surfaces the "section save needs backend" error.

---

## 8. Non-goals

- Backfilling historical `bowls_json` values to null. Leave old rows alone.
- Letting admins restore `your_bowls` as a section. Future verticals add their own hardcoded sections via the registry; nothing to re-expose here.
- Per-tier conditional sections / facets. Still scoped for a later brief.
- Renaming sections other than via `label_override` on the overrides payload. The variant-provided label is the fallback.

---

## 9. Backend action items

Give me the green light and I'll:

1. Drop `your_bowls` from the `club` entry in `get-club-variant` + redeploy both authed + public variants.
2. Add migration 161 (`clubs_data.join_form_overrides_json JSON NULL`) if not already there from Brief 106.
3. Build + deploy `PATCH /clubs/{id}/join-form-config` per Brief 106 §3.2.
4. Make `bowls` optional on the applications create handler (drop the `bowls_required` check, allow omission, persist `NULL`).

Rough time: 2–3 hours end-to-end. Zero behaviour change on existing clubs that don't re-save their join-form config.

---

## 10. Contact

Nev on Slack (`#torny-eng`). Related code: FE Option A changes landed in `483ee9e`; legacy-key filter follow-up queued for the next FE commit. Brief 106 FE modal lives in `apps/crm/src/components/modals/JoinFormEditorModal.vue`.

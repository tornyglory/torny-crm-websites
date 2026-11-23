# Footer config — owned by the club

**Feature:** the public site footer stops being a hardcoded placeholder and becomes admin-editable. Each club owns its own footer description, navigation columns, social links, legal links, and optional contact overrides. The CRM exposes a Settings → Website → Footer panel to edit them; the public `/site` payload hydrates the SiteFooter chrome with those values. The current hardcoded fallback in `apps/club-sites/layouts/default.vue` stays as a safety net for clubs that haven't configured anything yet.

**Status:** frontend chrome (SiteFooter) already consumes grouped columns, socials, legal links, and a contact block as props — the layout just can't source them from the backend today. Once this brief ships, the layout swaps its static constants for `site.footer.*` and the admin editor goes live.

**Related briefs:**
- brief 25 (navigation) — same shape pattern. `SiteNavigation.footer` already exists as a flat list on the payload, but the SiteFooter chrome needs grouped columns + socials + contact, which the flat list can't express. This brief adds a dedicated `footer` object alongside `navigation`, not inside it.
- brief 80 (navigation header overrides) — mirror the admin-only PUT endpoint shape (`PUT /clubs/:cid/navigation`) when adding `PUT /clubs/:cid/footer-config`.
- brief 110 (slug mismatch) — read the public `/site` endpoint by **subdomain**, same key used by every other SAM endpoint. The new `footer` section hydrates on the same payload, so no separate public resolve.
- brief 86 (plan tiers) — no gating in v1. All clubs get footer config regardless of plan. We may later restrict column count on starter → revisit when we see shape of usage.

---

## Base URL — CRM API (SAM stack)

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT for the write endpoint. Public read is on the existing `/public/clubs/:slug/site` endpoint — no auth, keyed on subdomain.

---

## 1. New `footer` section on `GET /public/clubs/{slug}/site`

Hydrated inline alongside the existing `club` / `contact` / `hours` / `membership_tiers` sections. When a club has never configured a footer, return `footer: null` — the frontend falls through to the hardcoded default.

```jsonc
{
  "status": "success",
  "data": {
    "club": { /* unchanged */ },
    "contact": { /* unchanged */ },
    "hours": [ /* unchanged */ ],
    "membership_tiers": [ /* unchanged */ ],

    // NEW — null until the admin saves something.
    "footer": {
      "description": "A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls.",
      "columns": [
        {
          "heading": "Explore",
          "links": [
            { "label": "Home", "href": "/" },
            { "label": "About the club", "href": "/about" },
            { "label": "Events", "href": "/events" },
            { "label": "Honour board", "href": "/honour-board" },
            { "label": "Gallery", "href": "/gallery" }
          ]
        },
        {
          "heading": "Play",
          "links": [
            { "label": "Membership", "href": "/membership" },
            { "label": "Coaching", "href": "/coaching" },
            { "label": "Function hire", "href": "/venue-hire" },
            { "label": "Sponsors", "href": "/sponsors" }
          ]
        }
      ],
      "socials": [
        { "icon": "instagram", "label": "Instagram", "href": "https://instagram.com/naenaebowls" },
        { "icon": "facebook",  "label": "Facebook",  "href": "https://facebook.com/naenaebowls" },
        { "icon": "email",     "label": "Email",     "href": "mailto:hello@naenaebowls.co.nz" }
      ],
      "legal_links": [
        { "label": "Privacy",  "href": "/privacy" },
        { "label": "Terms",    "href": "/terms" },
        { "label": "Cookies",  "href": "/cookies" }
      ],
      "contact_override": null
    }
  }
}
```

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `footer` | `object \| null` | `null` when the admin has never saved; FE uses hardcoded fallback. Once saved, the object is always present (even if every sub-array is empty). |
| `footer.description` | `string \| null` | Short blurb shown under the club name + logo. Max 300 chars after trim. Null → block is hidden. |
| `footer.columns` | `FooterColumn[]` | 0–4 columns. Each column has a heading + 1–8 links. |
| `footer.columns[].heading` | `string` | Required. Max 40 chars after trim. |
| `footer.columns[].links[]` | `FooterLink[]` | 1–8 links per column. Empty arrays are rejected on write (§2). |
| `footer.columns[].links[].label` | `string` | Max 40 chars after trim. |
| `footer.columns[].links[].href` | `string` | Same href rules as nav links (brief 25): relative `/path`, absolute `https://…`, or `mailto:` / `tel:`. See §4 Edge cases. |
| `footer.socials` | `FooterSocial[]` | 0–6 entries. See icon whitelist below. |
| `footer.socials[].icon` | `enum` | `instagram` \| `facebook` \| `twitter` \| `tiktok` \| `youtube` \| `linkedin` \| `email`. The chrome ships SVGs for these; unknown values are rejected on write. |
| `footer.socials[].label` | `string` | Used as `aria-label`. Max 40 chars. |
| `footer.socials[].href` | `string` | Absolute https / mailto / tel. Not relative. |
| `footer.legal_links` | `FooterLink[]` | 0–5 entries. Same shape as column links. Rendered inline next to the copyright. |
| `footer.contact_override` | `FooterContact \| null` | When set, replaces the public `contact` block in the footer only. Null → the existing public `contact` is used (addresses, email, phone — same fields as today). |
| `footer.contact_override.email` | `string \| null` | Must match a basic email regex when non-null. Max 120 chars. |
| `footer.contact_override.phone` | `string \| null` | Free-form; max 40 chars. We don't validate the format — clubs write their own (+64 4 567 1234, (04) 567 1234, etc). |
| `footer.contact_override.address_lines` | `string[] \| null` | 0–4 lines, each max 80 chars. Trailing empty strings stripped. |
| `footer.contact_override.status` | `string \| null` | Short pill ("Open until 9 PM", "Winter hours apply"). Max 40 chars. |

**No new auth or caching concerns** — this hydrates on the existing public cache key (brief 110: subdomain-keyed). Invalidate on the admin PUT (§2).

---

## 2. `PUT /clubs/{club_id}/footer-config` — admin write

Owner or admin only. Full-replacement PUT (no PATCH). Request body matches the read shape minus the `null` sentinel — to clear a saved footer, pass an explicit empty-but-valid shape (or we can accept `null` as "reset to fallback"; preference below).

```jsonc
// PUT /clubs/42/footer-config
// Authorization: Bearer <admin JWT>
{
  "description": "A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls.",
  "columns": [
    {
      "heading": "Explore",
      "links": [
        { "label": "Home", "href": "/" },
        { "label": "About the club", "href": "/about" }
      ]
    }
  ],
  "socials": [
    { "icon": "instagram", "label": "Instagram", "href": "https://instagram.com/naenaebowls" }
  ],
  "legal_links": [
    { "label": "Privacy", "href": "/privacy" }
  ],
  "contact_override": {
    "email": "hello@naenaebowls.co.nz",
    "phone": "(04) 567 1234",
    "address_lines": ["12 Vogel St", "Naenae, Lower Hutt 5011"],
    "status": null
  }
}
```

**Response** — echo the normalised, persisted shape (same fields as `/site` footer section):

```jsonc
{
  "status": "success",
  "data": {
    "description": "...",
    "columns": [...],
    "socials": [...],
    "legal_links": [...],
    "contact_override": {...},
    "updated_at": "2026-11-23T04:12:33Z"
  }
}
```

**Reset / clear.** Send `DELETE /clubs/{club_id}/footer-config` to blow away the saved config and revert to `null` on the public payload (FE falls back to hardcoded defaults). Preferred over accepting `null` on PUT — cleaner intent, easier to audit.

**Validation errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `footer_description_too_long` | > 300 chars. |
| 400 | `footer_columns_too_many` | > 4 columns. |
| 400 | `footer_column_heading_too_long` | heading > 40 chars. |
| 400 | `footer_column_empty` | column has 0 links. Either omit the column or give it at least one link. |
| 400 | `footer_column_too_many_links` | > 8 links in a single column. |
| 400 | `footer_link_label_too_long` | > 40 chars. |
| 400 | `footer_link_href_invalid` | fails the href-shape check (§4). |
| 400 | `footer_social_icon_unknown` | icon outside the whitelist. |
| 400 | `footer_social_href_invalid` | not absolute https / mailto / tel. |
| 400 | `footer_socials_too_many` | > 6. |
| 400 | `footer_legal_links_too_many` | > 5. |
| 400 | `footer_contact_email_invalid` | fails email regex. |
| 400 | `footer_contact_address_too_many` | > 4 lines. |
| 400 | `footer_contact_line_too_long` | any single line > 80 chars. |
| 403 | `forbidden` | non-admin caller. Same shape as every other admin write. |

---

## 3. `GET /clubs/{club_id}/footer-config` — admin read

Owner or admin. Returns the current saved shape (not the fallback — this is the thing the admin edits), or 404 with `footer_not_configured` when the club has never saved. The CRM editor uses this to seed the form.

```jsonc
// 200 — saved shape
{
  "status": "success",
  "data": { /* same as the PUT response */ }
}

// 404 — never saved
{
  "status": "error",
  "code": "footer_not_configured"
}
```

The CRM treats 404 as "show the defaults as pre-filled starting values" so the admin can see what the public site is currently serving and tweak from there.

---

## 4. Edge cases + Non-goals

**Href validation.** Mirror brief 25 / brief 80 nav link rules for consistency:

- Allowed: starts with `/` (relative in-site), starts with `https://` (external), `mailto:`, `tel:`.
- Disallowed: `javascript:`, `data:`, bare `www.example.com` (coerce to `https://` or reject — prefer reject, surfaces the admin's typo).
- `social.href` is stricter — relative paths are rejected (socials always point off-site).
- Trim whitespace before validation.

**Contact override vs public contact.** The public `/site.contact` is already surfaced in other parts of the site (contact page, header contact block). The footer's `contact_override` is purely cosmetic for the footer — it doesn't change the canonical `contact` record. We keep them separate so an admin can show a different email in the footer ("support@...") vs the contact page ("info@...") without side effects.

**Icon whitelist drift.** When the chrome adds a new social icon (e.g. `threads`), the validation enum needs bumping too. Keep the list in one place server-side (an enum / constant). Document the current list in the API response for the admin editor to render the picker (optional — can also be hardcoded FE-side with a weekly audit).

**Empty save.** Admin saves a form with everything blank — description null, columns empty, socials empty, contact_override null. That's valid. The public footer still renders (just the brand + copyright + powered-by strip). We don't 400 on "empty footer".

**Rate limits.** This is low-frequency admin writes. The existing admin-write limit on the SAM stack covers it — no new bucket.

**Cache invalidation.** The public `/site` payload is cached per-subdomain in the Worker. On PUT or DELETE, trigger the same `/api/revalidate` webhook already used by brief 80 (navigation updates). FE hooks into `revalidateHostForClub(clubId)` — no FE change needed if the backend fires the same hook.

**Non-goals (v1):**

- No per-page footer (every page shows the same footer).
- No "hide footer" toggle. Clubs that want a minimal footer configure one column + one legal link.
- No column reordering UI in v1 — the CRM editor renders columns in array order, admins reorder by dragging (JS-only, no backend reorder endpoint; the PUT replaces the whole array anyway).
- No social-link verification. We don't hit the URL to confirm the handle exists.
- No fancy address formatting (country-specific). Free-text lines, admin chooses the format.
- No scheduled "show this footer from X to Y" (e.g. seasonal). Can revisit if clubs ask.

---

## 5. Frontend contract

- `packages/api-client/src/resources/footer.ts` — new resource with `get(clubId)`, `put(clubId, payload)`, `delete(clubId)`. Types mirror §1 field table.
- `packages/api-client/src/types.ts` — add `FooterConfig`, `FooterColumn`, `FooterLink`, `FooterSocial`, `FooterSocialIcon` (enum), `FooterContactOverride` to the shared type surface so both CRM and content-blocks import from one place.
- `apps/club-sites/server/utils/tornyApi.ts` — extend `Site` with `footer: FooterConfig | null`. The existing `SiteNavigation.footer` field is unrelated and stays (deprecated label optional, but safer to leave it as-is for backwards-compat with any renderer that still reads it).
- `apps/club-sites/layouts/default.vue` — swap the static constants (lines 95–132) for `site.value?.footer`-derived computeds. Keep the hardcoded fallback as a safety net when `footer` is `null` or absent (older payloads) — same pattern as `FALLBACK_HEADER` in the same file.
- `apps/crm/src/views/settings/` — new `FooterEditorCard.vue` + a route like `/settings/website/footer`. Form has:
  - Description textarea (300-char counter).
  - Columns editor: add/remove column, add/remove link per column, inline href validation.
  - Socials editor: icon picker (whitelist), label, href.
  - Legal links editor: label + href.
  - Contact override toggle: when off, shows a muted preview of the public `contact` values; when on, exposes editable fields.
  - Preview panel on the right (desktop) / collapsed at the bottom (mobile) renders a scaled-down SiteFooter with the current form values live.
- Error handling: map each 400 code to a per-field inline message; map `forbidden` to a shell-level toast.

---

## 6. Verification (please attach outputs)

- ✓ Fresh club, no footer saved → `GET /public/clubs/:slug/site` returns `"footer": null`. Public site renders hardcoded fallback.
- ✓ Admin `GET /clubs/:cid/footer-config` on fresh club → 404 `footer_not_configured`.
- ✓ Admin PUT with a valid full payload → 200. Subsequent `GET /public/clubs/:slug/site` includes the saved `footer` object.
- ✓ Admin PUT with `description` of 301 chars → 400 `footer_description_too_long`.
- ✓ Admin PUT with 5 columns → 400 `footer_columns_too_many`.
- ✓ Admin PUT with a column containing 0 links → 400 `footer_column_empty`.
- ✓ Admin PUT with a link `href: "javascript:alert(1)"` → 400 `footer_link_href_invalid`.
- ✓ Admin PUT with a social `icon: "myspace"` → 400 `footer_social_icon_unknown`.
- ✓ Admin PUT with a social `href: "/instagram"` (relative) → 400 `footer_social_href_invalid`.
- ✓ Admin PUT with `contact_override.email: "not-an-email"` → 400 `footer_contact_email_invalid`.
- ✓ Admin PUT then `DELETE /clubs/:cid/footer-config` → 200. `/site` returns `"footer": null` again.
- ✓ Non-admin (e.g. member) PUT → 403 `forbidden`.
- ✓ After PUT, the Worker cache for this club's subdomain is invalidated within one revalidate cycle (same window as brief 80's navigation updates).
- ✓ Two clubs with the same subdomain-drift scenario from brief 110 (Naenae + Richmond Union) both get footer config honoured (confirm subdomain-keyed hydration, not canonical-slug-keyed).

---

## 7. Contact

Frontend: this working directory. Ping when the response shape is close to shipping — the SiteFooter chrome already accepts this exact shape as props, so the layout swap is a few lines. We can land the admin editor behind the live endpoint once the GET / PUT / DELETE are up on `dev`.

# Brief 121 — Expose `email_handle` on `GET /clubs/{id}` (SHIPPED)

**STATUS — SHIPPED 2026-11-26 (commit f26b1b5).**

`email_handle` now lands on the top-level `data` object of `GET /clubs/{id}`. The Settings → Email Inbox card can read it without a second round-trip. `null` when the admin hasn't picked a handle yet.

Shape matches option 1 from the proposal — same accessor as brief 100 §10.2's PATCH response.

**Scope shipped:**
- API (CRM stack): one-line addition to the `GET /clubs/{id}` handler — `email_handle` added to the SELECT + response.
- **Prereq:** brief 100 (per-club inbox) — shipped.

---

## 1. The endpoint

```
GET https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{id}
Authorization: Bearer <admin JWT>  — or Cookie: torny_sid=… (brief 119)
```

Requires a CRM admin or owner role on the club.

---

## 2. Response shape

```jsonc
{
  "status": "success",
  "data": {
    "id":           5,
    "slug":         "naenae-bowling-club",
    "name":         "Naenae Bowling Club",
    "domain":       null,
    "primary_host": "naenae-bowling-club.torny.pro",

    "email_handle": "naenaebowlingclub",   // NEW — brief 121

    "brand_primary": "#0A0A0B",
    "logo_url":      "https://…",
    "favicon_url":   null,
    "onboarded_at":  "2026-08-24T09:43:22.000Z",

    "fonts":      { … },
    "style":      { … },
    "navigation": { … }
  }
}
```

**Field semantics:**
- `email_handle: string | null`. Lowercase, max 63 chars (same constraint as the PATCH validator in brief 100 §10.1).
- `null` means the admin hasn't picked a handle yet. FE shows the **Pick a handle** button.
- Non-null means `<email_handle>@torny.pro` is the live inbound address.

No other response fields changed. Everything else on this endpoint is byte-for-byte identical to pre-121.

---

## 3. FE wiring

The existing `apps/crm/src/stores/club.ts` → `hydrateFull` call already does the right thing — it reads `email_handle` from the response (plus `emailHandle` + `data.club.email_handle` fallbacks that we shipped on 2026-11-26 while waiting on this brief). **No code change needed; the field just starts appearing.**

The parallel Venue-stack call from `ClubInboxCard.vue:onMounted` → `clubs.getEmailHandle()` (also added 2026-11-26) stays as belt-and-braces — it's a one-liner and keeps the surface resilient if the CRM-stack endpoint ever regresses. Can be removed in a cleanup sweep later once brief 121's response is confirmed stable in prod.

### What visibly flips on next CRM reload for a club with a handle set

- Settings → Email Inbox card stops showing the `yourclub@torny.pro` placeholder.
- Renders `<handle>@torny.pro` using the real value.
- "Pick a handle" button hides when `email_handle !== null`.

---

## 4. Verification

### Live smoke (ran during the ship)

```sh
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
curl -s "$CRM/clubs/5" -H "Cookie: torny_sid=<admin session>" | jq .data | head -5
# → {
#     "id": 5,
#     "slug": "naenae-bowling-club",
#     "name": "Naenae Bowling Club",
#     "email_handle": "naenaebowlingclub",
#     ...
#   }
```

### CRM DevTools one-liner (from the original brief §3 — now passes)

```js
(async () => {
  const token = localStorage.getItem('torny.token')
  const cid = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('torny.club.current'))))?.id
  const res = await fetch(`https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/${cid}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  console.log('email_handle?', body?.data?.email_handle)
})()
// → "naenaebowlingclub" for club 5
```

---

## 5. Pass criteria

- ✓ `GET /clubs/{id}` carries `email_handle` on the top-level `data` for every club.
- ✓ Returns the lowercase handle string when set; `null` when the admin hasn't picked one yet.
- ✓ No other fields changed on the response.
- ✓ Settings → Email Inbox card renders `<handle>@torny.pro` on next page refresh for Naenae (and every other club with a saved handle).

---

## 6. Related briefs

- **Brief 100** — per-club inbox. §10.2's PATCH response uses the same `email_handle` key at the top of `data`; GET is now consistent.
- **Brief 110** — slug canonicalisation. Not entangled with `email_handle` (handles are an orthogonal namespace — admins can pick any handle regardless of their subdomain/slug).

---

## 7. Contact

Nev on `#torny-eng`.

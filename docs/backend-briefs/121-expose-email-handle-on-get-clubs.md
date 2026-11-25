# Brief 121 — Expose `email_handle` on `GET /clubs/{id}`

**Status — proposed. Not yet scoped on the backend roadmap.**

> **FE-side ask on day one:** make sure `GET /clubs/{id}` returns the club's current `email_handle` in a way the CRM can read without a separate round-trip. Brief 100 specified that the FE `club` store reads the handle via `hydrateFull`'s `GET /clubs/{id}` call, but the actual response shape wasn't pinned down — and in practice the FE is seeing it come back empty even for clubs that have an active handle. The Inbox card then renders the placeholder (`yourclub@torny.pro`) which is confusing for admins whose outbound mail is already going out as `<handle>@torny.pro`.

See the live report (2026-11-26): club 5 (Naenae Bowling Club) sends outbound as `naenaebowlingclub@torny.pro` but the Settings → Email card shows the placeholder.

---

## 1. What the FE needs

The FE's `apps/crm/src/stores/club.ts` calls `GET /clubs/{id}` on first visit to Settings → Email and expects `email_handle` on the response. It accepts both `email_handle` (snake) and `emailHandle` (camel), and also probes a nested `data.club.email_handle` shape, so any of those three locations will work. The current response doesn't seem to carry any of them.

Please pick one and stick with it — preference, in order:

1. **Flat `email_handle` at the top of `data`.** Matches brief 100's §10.2 PATCH response shape:
   ```jsonc
   {
     "status": "success",
     "data": {
       "id": 5,
       "slug": "naenae-bowling-club",
       "email_handle": "naenaebowlingclub",
       // … every other field already on this response …
     }
   }
   ```
2. **Nested under `data.club`.** Workable if you're already splitting the response into sections (settings / integrations / etc.).
3. **A dedicated section, e.g. `data.integrations.email_handle`.** Only if the above don't fit the existing handler structure.

Whichever shape you ship, add a line to the brief 100 ship-live doc (or a new `100-per-club-inbox-live.md`) so this isn't ambiguous for the next FE change.

---

## 2. Null semantics

- Return `email_handle: null` for clubs that haven't picked one yet (not `undefined`, not missing). The FE already handles `null` as "show the Pick a handle button".
- Return the current handle as a lowercase string (matches §10.1's validator).

---

## 3. Verification

Once shipped, this one-liner on the CRM confirms it:

```js
// Settings → Email → DevTools console
(async () => {
  const token = localStorage.getItem('torny.token')
  const cid = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('torny.club.current'))))?.id
  const res = await fetch(`https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/${cid}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  console.log('email_handle?', body?.data?.email_handle ?? body?.data?.club?.email_handle)
})()
```

Should print `"naenaebowlingclub"` for club 5. Once that prints, the Inbox card will light up next page refresh — the FE already hydrates on mount (`ClubInboxCard.vue:onMounted` → `clubStore.hydrateFull({ force: true })`).

---

## 4. Related briefs

- Brief 100 — the owning brief. §11 "FE status — shipped" says the handle is carried through `hydrateFull`; this brief closes the one gap left open there.
- Brief 110 — subdomain + slug canonicalisation. If `email_handle` and `subdomain` are supposed to stay in sync for clubs that haven't customised their handle, flag that here so the FE can display the right default.

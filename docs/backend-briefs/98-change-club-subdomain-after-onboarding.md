# Brief 98 — Change club subdomain after onboarding

**Scope:**
- API (this repo): one new handler `PATCH /clubs/{club_id}/subdomain`. Reuses existing validator, availability endpoint, and KV write path.
- FE (`tornyglory/torny-crm-websites`): Settings → Website → Domain page gets an editable Torny-subdomain section with live availability check + explicit save + confirm dialog.

**Prereq:** none. The Worker-fronted multi-tenant stack is live — subdomains are kept consistent in DB (`clubs_data.subdomain`, `primary_host`) and Cloudflare KV (`host:<primary_host>` → `clubId`), both owned by this API.

---

## 1. The ask

The CRM Domain page already shows the club's Torny-hosted subdomain as a "Fallback" block — e.g. `kelburn.torny.club`. Right now it's read-only. The owner needs to be able to change it:

- Type a new subdomain → live "is this available?" check as they type.
- If available + the owner clicks Save → a confirm dialog warns about the implications, then the change commits.
- On success: the page re-renders with the new subdomain. Any old URL (`old.torny.club`) stops resolving within a couple of seconds.

---

## 2. Why

- **Onboarding typos / rebrands.** Clubs pick a subdomain in the wizard and never revisit it. We've already seen cases where a club wants to fix a typo, drop the "test-" prefix, or align with their rebrand. Today the only recourse is a DB UPDATE.
- **No destructive side-effects at today's scale.** Pre-launch. Zero traffic. Changing a subdomain only breaks (a) outbound links already baked into sent emails and (b) search-engine indexes — both negligible right now.
- **Already mostly built.** `src/handlers/utils/subdomain.js` has validator + reserved list + `isTaken` helper; `GET /subdomains/check?value=X` lives at `src/handlers/check-subdomain/index.js`; `putHostKv` / `deleteHostKv` sit in `src/handlers/utils/cloudflare-pages.js`. The new endpoint is mostly orchestration.

---

## 3. Backend — endpoint spec

### 3.1 `GET /subdomains/check?value=<proposed>`

**Already exists.** No change needed. Document for FE reference:

```http
GET /subdomains/check?value=kelburn
Authorization: (optional; no gate — public-signup uses it unauthenticated)
```

```json
200 { "available": true,  "value": "kelburn" }
200 { "available": false, "reason": "taken",    "value": "kelburn" }
200 { "available": false, "reason": "reserved" }
200 { "available": false, "reason": "invalid" }
```

- `reason: "invalid"` — fails the format check (3–30 chars, lowercase alphanumerics + hyphen, no leading/trailing hyphen).
- `reason: "reserved"` — matches the RESERVED set (`www`, `api`, `admin`, `app`, `crm`, `sites`, `torny`, etc. — full list in `src/handlers/utils/subdomain.js`).
- `reason: "taken"` — another club owns it.

**Safety:** response never leaks which club owns a taken subdomain. FE can show "that one's taken, try another" — nothing more.

### 3.2 `PATCH /clubs/{club_id}/subdomain` — new

```http
PATCH /clubs/42/subdomain
Authorization: Bearer <JWT>
Content-Type: application/json

{ "subdomain": "kelburn-bowls" }
```

**Auth:** owner-only (same gate as `complete-club-onboarding`). Uses the existing `requireClubRole(connection, userId, clubId, 'owner')`.

**Handler steps (one DB transaction + two KV calls):**

1. Validate payload. Reject `400` on missing/empty subdomain.
2. Run `validateSubdomain(body.subdomain)`. On fail → `422` with `code: subdomain_invalid` or `subdomain_reserved`.
3. Normalise to lowercase trimmed value (the validator already returns `value`).
4. Load the current row: `SELECT subdomain, primary_host FROM clubs_data WHERE club_id = ?`. If not found → `404`.
5. If the new value equals the current `subdomain` (case-insensitive) → return `200` no-op with the current state. FE renders this as "no change".
6. `isTaken(connection, newValue, clubId)` → `409 subdomain_taken` if yes.
7. Compose `newHost = clubHostFor(newValue)` (via `utils/club-site-domain.js` — do NOT hardcode `.torny.club`).
8. **Write KV first** — `putHostKv(newHost, clubId)`. If this fails → `502 provision_failed`, DB untouched. Rationale: a half-written state where the DB says "live at newHost" but KV doesn't resolve breaks the public site. KV first means the new host serves before the DB cutover.
9. **DB cutover** in a transaction:
   ```sql
   UPDATE clubs_data
      SET subdomain = ?,
          primary_host = ?,
          pages_domain_status = 'live',
          pages_domain_last_error = NULL,
          pages_domain_updated_at = NOW()
    WHERE club_id = ?
   ```
10. Fire-and-forget `deleteHostKv(oldHost)` — don't await it or fail the request on it. The old KV entry becoming stale is harmless (nothing points there after the DB updates). A failure here just means the old URL continues to resolve to this club for a while, which is cosmetic.
11. Return the new state:
    ```json
    {
        "status": "success",
        "data": {
            "club_id": 42,
            "subdomain": "kelburn-bowls",
            "primary_host": "kelburn-bowls.torny.club",
            "public_url": "https://kelburn-bowls.torny.club"
        }
    }
    ```

**Error envelope** — standard `{ status: "error", code, message }` shape. `code` values:

| Code | HTTP | When |
|---|---|---|
| `subdomain_required` | 400 | payload missing or empty |
| `subdomain_invalid` | 422 | fails format check |
| `subdomain_reserved` | 422 | in RESERVED set |
| `subdomain_taken` | 409 | another club owns it |
| `provision_failed` | 502 | KV write to Cloudflare failed |
| `forbidden` | 403 | caller isn't an owner |
| `not_found` | 404 | club_id doesn't exist |

**Routing** — add in `cdk/lib/crm-stack.ts` under `clubIdResource`, something like:

```ts
clubIdResource.addResource('subdomain').addMethod('PATCH', crmIntegration, { authorizer });
```

Then wire the handler in `src/handlers/crm-router/index.js`'s dispatch table.

---

## 4. FE — the editing experience

### 4.1 Where it goes

Settings → Website → Domain tab. The "Fallback" block currently shows the Torny-hosted subdomain read-only. Add an **Edit** button next to it (same visual treatment as the Custom Domain's Edit button for consistency).

### 4.2 Edit flow

1. Click Edit → the fallback block expands into an inline editor:
   - Text input with the current subdomain pre-filled.
   - "What follows" preview: `<input>.torny.club` (built via the same helper the rest of the app uses).
   - Save + Cancel buttons.
2. As the owner types (debounce 300ms):
   - Call `GET /subdomains/check?value=<typed>`.
   - Show inline status:
     - typing → "Checking…"
     - `available: true` → green check + "Available"
     - `reason: "invalid"` → "Must be 3–30 chars, lowercase letters, numbers, hyphens"
     - `reason: "reserved"` → "That subdomain is reserved"
     - `reason: "taken"` → "Already in use"
3. Save button is enabled **only** when the typed value is valid + available + different from the current.
4. Clicking Save opens a confirm modal:

   > **Change this club's subdomain?**
   >
   > The new URL will be `https://kelburn-bowls.torny.club`.
   >
   > The old URL (`https://kelburn.torny.club`) will stop working within a few seconds. Links already sent in emails or shared externally will break.
   >
   > *(Custom domain settings are unaffected.)*
   >
   > Confirm / Cancel
5. Confirm → `PATCH /clubs/{club_id}/subdomain` with `{ subdomain: <new> }`.
6. On success → close modal, re-render the Domain page with the new primary_host + public_url. Show a toast "Subdomain changed to `kelburn-bowls.torny.club`". The displayed URL in the FALLBACK block updates immediately.
7. On error → stay in the modal, surface the `message` from the error envelope. For `subdomain_taken` specifically, bump back to the editor state with the "Already in use" indicator (something else grabbed it between the check and the save — rare but possible).

### 4.3 Who can see / use it

- Non-owners: Edit button hidden (role check from existing auth context).
- Owners: Edit button visible, flow as above.

---

## 5. Verification

```bash
CRM="https://…"
TOKEN="…"   # owner JWT
CLUB=42

# 1. Availability check — happy path
curl -s "$CRM/subdomains/check?value=kelburn-bowls" | jq
# → { "available": true, "value": "kelburn-bowls" }

# 2. Availability check — taken (use an existing club's subdomain)
curl -s "$CRM/subdomains/check?value=nae-nae-bowling-club" | jq
# → { "available": false, "reason": "taken", "value": "nae-nae-bowling-club" }

# 3. Availability check — reserved
curl -s "$CRM/subdomains/check?value=admin" | jq
# → { "available": false, "reason": "reserved" }

# 4. Change — happy path
curl -s -X PATCH "$CRM/clubs/$CLUB/subdomain" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"subdomain":"kelburn-bowls"}' | jq
# → { status: "success", data: { subdomain: "kelburn-bowls",
#       primary_host: "kelburn-bowls.torny.club",
#       public_url: "https://kelburn-bowls.torny.club" } }

# 5. End-to-end — new URL serves, old URL 404s (5–10 sec KV propagation)
sleep 10
curl -I https://kelburn-bowls.torny.club/     # → 200
curl -I https://kelburn.torny.club/           # → 404 unknown_host (Worker)

# 6. Idempotent re-save of the same value
curl -s -X PATCH "$CRM/clubs/$CLUB/subdomain" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"subdomain":"kelburn-bowls"}' | jq
# → 200 no-op, returns the current state

# 7. Taken — another club's value
curl -s -X PATCH "$CRM/clubs/$CLUB/subdomain" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"subdomain":"nae-nae-bowling-club"}'
# → 409 { code: "subdomain_taken" }

# 8. Non-owner is blocked
curl -s -X PATCH "$CRM/clubs/$CLUB/subdomain" -H "Authorization: Bearer $ADMIN_BUT_NOT_OWNER_TOKEN" \
    -H "Content-Type: application/json" -d '{"subdomain":"anything-else"}'
# → 403 { code: "forbidden" }
```

---

## 6. Pass criteria

- ✓ `GET /subdomains/check` returns one of the four `reason` codes with no leak about the owning club.
- ✓ `PATCH /clubs/{club_id}/subdomain` rejects non-owners, invalid formats, reserved names, taken names, and KV-write failures with the right code + status.
- ✓ On success: DB `subdomain` + `primary_host` updated atomically; new KV entry written **before** DB cutover; stale KV entry deleted best-effort.
- ✓ Worker resolves the new host within a few seconds (KV consistency is typically <1s edge-wide); old host 404s with `unknown_host`.
- ✓ No regressions: existing clubs that don't touch this endpoint behave exactly as today.

---

## 7. Non-goals

- 301 redirect from old subdomain → new. Defer until there's a real risk of breaking externally-shared links (post-launch). A separate brief + Worker change.
- Reserving the old subdomain for a grace period so it can't be reclaimed immediately. Not needed pre-launch.
- Custom-domain editing on the same page. That's a separate flow with ACM/DNS verification; this brief only covers the Torny-hosted subdomain.
- Changing the subdomain from non-owners (admins). If you want delegated admin control later, separate brief.
- Rate-limiting the availability endpoint. It's a cheap DB read keyed on an indexed column, and it's already used unauthenticated by the signup wizard. Revisit if abuse shows up in logs.

---

## 8. Contact

Nev on Slack (`#torny-eng`). Backend: one handler + one CDK route + one router dispatch entry. FE: one page section + one modal. Flag anything unclear and I'll clarify.

---

## 9. FE status — shipped (pending backend)

Landed in:
- `packages/api-client/src/resources/clubs.ts` — `changeSubdomain(clubId, value)` →
  `PATCH /clubs/{id}/subdomain`. Typed `ChangeSubdomainErrorCode` export covers
  every error code in §3.2's table.
- `apps/crm/src/components/WebsiteSettingsPanel.vue` — Fallback card gains an
  Edit button (owner-only, via `usePermissions().isOwner`). The editor renders
  an input with a `.torny.club` suffix and a live availability check calling
  `clubOnboarding.checkSubdomain` (reused from the signup wizard). 300ms
  debounce, in-flight requests get aborted on new keystrokes, local
  short-circuit on obvious invalids so we don't flash "Checking…" on a single
  character. Save enables only when `available && draft !== current`.

Click Save → confirm modal with the exact copy from §4.2 (new URL, old URL
warning, custom-domain reassurance). Confirm → `PATCH`. On success the
`clubStore.current.slug` is patched in-place so the Preview button's
`sitePreviewUrl` picks up the new host without a page refresh, and a toast
confirms. `subdomain_taken` races drop the user back to the editor state with
the "Already in use" indicator (brief 98 §4.2 step 7).

Nothing calls the endpoint until the backend ships it — safe to merge the FE
ahead of the handler. Verification steps from §5 will go green once:
- `PATCH /clubs/{id}/subdomain` exists on CRM API.
- KV write-before-DB ordering is in place so the new host serves pre-cutover.

---

## 10. Follow-up — keep the wizard snapshot in sync

The PATCH handler now updates `clubs_data.subdomain` + `primary_host` + the
KV. Confirmed working end-to-end (curl against `/clubs/resolve?host=`
returns the new host). One drift remains: `GET /clubs/{id}/onboarding`
still returns the **wizard-completion snapshot** of `data.subdomain`, so a
club that renamed from `nae-nae-bowling-club` → `naenae-bowling-club` via
this endpoint still has `"nae-nae-bowling-club"` in the onboarding blob.

The FE has shipped a workaround — the Website editor's Preview button now
reads `clubStore.current.slug` (which comes from `/clubs/{id}` and is
authoritative) before the onboarding snapshot
(`apps/crm/src/views/website/WebsiteEditorView.vue`, commit `098d7a5`).
That unblocks Preview, but the inconsistency is still there for any
future consumer that reads the wizard blob.

**Ask:** inside the brief-98 handler, after the DB cutover in step 9,
also patch the wizard snapshot so the two storages stay in sync. Depending
on how the wizard is persisted, that's either:

```sql
-- If onboarding state lives in a JSON column on `clubs_data`:
UPDATE clubs_data
   SET onboarding_data = JSON_SET(onboarding_data, '$.subdomain', ?)
 WHERE club_id = ?
```

…or the equivalent write against whatever table holds the onboarding
JSON. Idempotent, same-transaction as the primary cutover, no new error
codes.

**Verify** after the change: the existing §5 test suite plus one more:

```bash
# After step 4 (PATCH subdomain), the wizard snapshot reflects it.
curl -s "$CRM/clubs/$CLUB/onboarding" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.data.subdomain'
# → "kelburn-bowls"   (was: "kelburn")
```

Not urgent — the FE isn't using that field for routing anymore. But worth
closing the drift before someone else wires a feature off the wizard
snapshot and gets surprised.


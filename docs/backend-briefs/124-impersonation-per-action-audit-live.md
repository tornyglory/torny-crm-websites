# Brief 124 — Per-action audit log for impersonation sessions

**STATUS — PHASE 1 SHIPPED 2026-11-27 (commit `21308b5`).**

Every mutating API call made during an active impersonation session now writes an attributable row to `platform_admin_audit`, linked back to the parent `impersonate` row via a new `session_id` column.

No new endpoints — this brief is pure backend plumbing that extends the existing `GET /admin/audit` reader (brief 123 §6.5) with a new action kind + a new filter.

**Scope shipped:**
- Migration 171 — `session_id BIGINT NULL` + `idx_paa_session` on `platform_admin_audit`
- Impersonation JWT now carries `impersonation_session_id` claim
- Authorizer writes `impersonated_action` audit row for every mutating request from an impersonation JWT
- `GET /admin/audit` accepts `?filter[session_id]=<id>` + surfaces `session_id` on each row
- `filter[action]` accepts `impersonated_action` as a new value

**Prereq:** brief 123 Phase 2 shipped — `platform_admin_audit` table + `impersonated_by` JWT claim both live.

---

## 1. What gets audited

Every HTTP POST, PUT, PATCH, or DELETE made with an impersonation JWT writes one audit row:

```jsonc
{
  "id": 42,
  "at": "2026-11-27T03:23:37.000Z",
  "action": "impersonated_action",
  "session_id": 11,                                   // parent impersonate row's id
  "actor": {                                          // the platform admin
    "user_id": 53,
    "email": "nev@torny.co",
    "name": "Neville Rodda"
  },
  "target_club": {                                    // null on this row — captured on session-start instead
    "id": null, "name": null, "subdomain": null
  },
  "target_user": {                                    // who they're acting as
    "id": 1111,
    "email": "nigel@torny.co"
  },
  "reason": null,                                     // reason belongs to session-start
  "payload": {
    "method": "PUT",
    "path": "/clubs/5/footer-config",
    "as_user_id": 1111
  },
  "ip": "202.37.71.10",
  "user_agent": "Mozilla/5.0 …"
}
```

### What does NOT get audited

- **GET requests** — read-only traffic doesn't swamp the log. If "which pages did the admin view during session X" ever becomes a real need, it's a separate opt-in.
- **Normal platform admin mutations outside of impersonation** (`impersonate` itself, `comp_plan`, `suspend`, `grant/revoke`). Those already write their own rows via the brief 123 Phase 2 handlers.
- **Non-impersonation user traffic.** Only JWTs that carry the `impersonated_by` claim trigger this write.

---

## 2. Query shapes

### 2.1 Group every row in one session

```
GET /admin/audit?filter[session_id]=11
```

Returns the parent `impersonate` row and every `impersonated_action` row that points at it, newest first.

### 2.2 Everything the admin did during impersonation (no filter)

```
GET /admin/audit?filter[action]=impersonated_action
```

Cross-session view. Combine with `filter[actor]=<user_id>` to see one admin's impersonation footprint, or `filter[target_club]=<club_id>` to see everything done to a given club during impersonation.

### 2.3 Session-scoped by target club

```
GET /admin/audit?filter[target_club]=5&filter[action]=impersonated_action
```

Everything done to Naenae under impersonation, across every admin and every session.

---

## 3. Payload shape — current + future

### Phase 1 (what landed)

```jsonc
"payload": {
  "method": "PUT",
  "path": "/clubs/5/footer-config",
  "as_user_id": 1111
}
```

Just method + path + the user the admin is acting as. **No body, no response code, no affected-resource id.** This matches the original brief's §4 default policy (method + path + no values) and is appropriate for the authorizer-level implementation — see §5 for why.

### Phase 2 (future, not shipped)

The original brief's §3.1 richer shape (`response_status`, `resource_affected`, per-endpoint `body_summary`) would need a handler wrapper to capture after the mutation runs. Punted because:
- Requires touching every mutating handler or standing up a wrapper layer
- Primary evidentiary value is "the attempt happened at this time" — already captured
- Per-endpoint-family redaction (original brief §4 table) is significant per-handler work without a runtime framework for it

If Product wants `response_status` next, that's a concrete next ship. The DB column doesn't need to change — just add a nullable `response_status` key to the JSON payload.

---

## 4. Payload sanitization — what the current shape ensures

**Non-negotiable: no secrets, no PII in the audit payload.**

Phase 1 never sees the body — the authorizer runs BEFORE the handler and doesn't have access to the request body. So there's no risk of logging email contents, member DOBs, Stripe keys, etc. The payload is strictly `{ method, path, as_user_id }`, all non-sensitive.

Phase 2's richer `body_summary` would need per-endpoint-family redaction (original brief §4 table). That's a known future hazard flagged for when we build it.

---

## 5. Architectural decision — authorizer, not `requireClubRole`

The original brief §2 suggested putting the audit write in `requireClubRole`. The ship put it in the authorizer instead.

**Why:**
- **Single edit catches everything.** `requireClubRole` is called by the CRM handlers but not by every mutating path. The authorizer gates every authenticated path across all four stacks.
- **Natural opt-in via the claim.** Only impersonation JWTs carry `impersonated_by`. Normal platform admin sessions (cookie or Bearer from login) don't — so there's no double-logging risk with the brief-123 Phase 2 rows.
- **Simpler.** One small edit vs. one slightly larger edit + the risk of missing a mutating path that doesn't use `requireClubRole`.

**Trade-off accepted:** the authorizer can't see the request body, so Phase 1 only captures method + path, not `body_summary`. The original brief's default policy (method + path + `body_field_names`) is partially captured; richer per-endpoint-family payloads come in Phase 2 via a handler wrapper.

---

## 6. FE surfaces (what to build)

### 6.1 Audit list filter (existing admin portal)

Already wired into `GET /admin/audit`. Dropdown on the Action column gains `impersonated_action` as an additional choice.

### 6.2 "Show session actions" expander

On any `impersonate` row in the audit list, clicking "View session" fires:

```
GET /admin/audit?filter[session_id]=<row.id>
```

Renders a collapsible table under the row with every mutating call made during that session, oldest first. Great for support follow-ups: "here's exactly what we did while acting as you between 14:32 and 14:47".

### 6.3 Live action counter during impersonation (optional)

While impersonating, the impersonation banner can show "X actions this session" by polling:

```
GET /admin/audit?filter[session_id]=<current_session_id>&filter[action]=impersonated_action
```

Current session id is available on the FE — the impersonation JWT's `impersonation_session_id` claim (decodable with jwt-decode or similar — the JWT isn't HttpOnly, it's passed in `Authorization`).

### 6.4 Do NOT surface `impersonated_action` on the per-account timeline

The account detail timeline (`GET /admin/accounts/{id}` → `data.timeline`) stays clean. Keep showing the `impersonated` session-start row; the full action list is a drill-in from there.

---

## 7. Verification — live against prod

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN=<platform admin cookie session>

# 1. Impersonate a club owner
IMP=$(curl -s -X POST "$VENUE/admin/accounts/5/impersonate" \
  -H "Cookie: torny_sid=$TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"support-ticket-4421"}')
JWT=$(echo "$IMP" | jq -r .data.impersonation_jwt)

# 2. Make a mutating call AS the impersonated user
curl -s -X PUT "$VENUE/clubs/5/footer-config" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"columns":[]}'
# → 200

# 3. Make a GET during impersonation — should NOT be audited
curl -s "$VENUE/clubs/5/footer-config" -H "Authorization: Bearer $JWT"
# → 200

# 4. Query the session
SESSION_ID=$(curl -s "$VENUE/admin/audit?filter[action]=impersonate&limit=1" \
  -H "Cookie: torny_sid=$TOKEN" | jq -r .data.items[0].id)
curl -s "$VENUE/admin/audit?filter[session_id]=$SESSION_ID" \
  -H "Cookie: torny_sid=$TOKEN" | jq .data.items[].action
# → ["impersonated_action", "impersonate"]  — just the PUT action, no GET row
```

---

## 8. Pass criteria

- ✓ `POST /admin/accounts/{id}/impersonate` writes the session-start row + mints a JWT carrying both `impersonated_by` AND `impersonation_session_id`
- ✓ A mutating call (POST / PUT / PATCH / DELETE) made with the impersonation JWT writes an `impersonated_action` row with `session_id` pointing at the parent
- ✓ A GET made with the same JWT writes NO audit row
- ✓ Normal platform-admin traffic (admin cookie session, no impersonation) writes NO `impersonated_action` rows
- ✓ `/admin/audit?filter[session_id]=<id>` returns the parent + every action row for that session
- ✓ `/admin/audit?filter[action]=impersonated_action` returns only the per-action rows
- ✓ Audit write failure doesn't block the mutation — the user still sees success, CloudWatch warns
- ✓ Payload carries `method` + `path` + `as_user_id`. No request body contents. No response body contents.

---

## 9. Non-goals (Phase 1)

- **Read endpoint logging.** Not shipping. Row volume explosion for marginal value.
- **Real-time push on impersonation activity.** The log is pull-based.
- **Automated replay / undo.** Audit describes what happened; it doesn't carry enough fidelity to automatically reverse.
- **PII in payloads.** Firmly out. Primary tables (`email_batches`, `venue_bookings`, etc.) already have per-row access controls.
- **`response_status` + `resource_affected` decoration.** Phase 2 — needs a handler wrapper.
- **Per-endpoint-family richer `body_summary`.** Phase 2 — same reason.

---

## 10. Related briefs

- Brief 123 Phase 2 — platform admin portal actions + the base audit table.
- Brief 115 — HttpOnly cookies. Doesn't affect this; both Bearer and cookie sessions carry the same JWT claim bag.
- Brief 40 — CRM notifications pipeline. §8 of the original brief 124 discusses an optional "notify the real owner on impersonation" hook — separate ship if we want it.

---

## 11. Contact

Nev on #torny-eng. Phase 2 (response decoration + richer payloads) is a separate ship — pitch when there's a concrete need.

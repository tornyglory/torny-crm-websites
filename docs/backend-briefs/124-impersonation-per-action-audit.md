# Brief 124 — Per-action audit log for impersonation sessions

**Status:** proposed. Not yet scoped on the backend roadmap.

**Feature:** every mutating API call made during an active impersonation session writes an attributable row to `platform_admin_audit` so the backend has a full "what did the admin actually do while acting as this owner" trail. Brief 123 Phase 2 already logs the impersonation *start* (one row per session with the admin's reason); this closes the gap between "started a session" and "did things during it".

**Why ship this:**
- **Accountability.** Right now an admin could impersonate, compose a bulk email to 200 of a club's members under the club president's name, send it, and exit. The real owner sees the sent email in their communications tab with no indication it was authored by a platform admin — just their own identity on the row. If the owner later says "I didn't send that", we have no record of what we did between start and stop.
- **Deterrent effect on ourselves.** The existence of a per-action log changes the admin's behaviour. "Will I be comfortable explaining this action to the owner" becomes a real question at the moment of clicking Send, instead of a hypothetical.
- **Customer trust.** Being able to point at an auditable record ("here's everything I did in your account between 14:32 and 14:47 on 2026-11-26, as requested") is a nontrivial differentiator over SaaS tools that just run roughshod with god-mode support access.

**Prereq:** brief 123 Phase 2 shipped — `platform_admin_audit` table + `impersonated_by` JWT claim both live.

**Related briefs:**
- Brief 123 — platform admin portal. Phase 2 added impersonation + session-start audit rows. This brief extends the audit model.
- Brief 115 — HttpOnly cookies. Does not affect this; both Bearer and cookie sessions carry the same JWT claim bag.
- Brief 40 — CRM notifications pipeline. §8 of this brief discusses an optional "notify the real owner on impersonation" hook that would use it.

---

## 1. Base URL

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

No new endpoints — this brief is pure write-side plumbing that extends existing CRM mutations with an audit write. The admin portal reads via the existing `GET /admin/audit` from brief 123 §6.5.

---

## 2. Trigger point

Every handler that passes through `requireClubRole()` (the same gate that already enforces suspension per brief 123 §6.3) should check the JWT for an `impersonated_by` claim. When present AND the HTTP method is **mutating** (POST / PUT / PATCH / DELETE), write an audit row BEFORE the handler executes its actual work.

Pseudo-shape of the middleware addition:

```ts
// Inside requireClubRole, after resolving clubId + role:
const impersonatedBy = jwt.impersonated_by // string or undefined
const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)

if (impersonatedBy && isMutation) {
  await writeAudit({
    action: 'impersonated_action',
    actor_user_id: Number(impersonatedBy), // the platform admin
    target_club_id: clubId,
    target_user_id: jwt.userId,            // the user they're acting as
    payload: redactBody(req.method, req.path, req.body),
    reason: null,                           // reason belongs to the session start
    ip: req.ip,
    user_agent: req.headers['user-agent'] ?? null,
  })
}
```

Write synchronously (same request, same transaction where possible). If the audit write fails the mutation should still succeed — an audit outage is non-fatal, same discipline as the brief 112 fanout failures. Log the audit error to CloudWatch as a `console.warn`.

**Why `requireClubRole` specifically:** it's the funnel every non-admin mutating CRM endpoint passes through. Extending it catches everything in one place instead of touching 40+ handlers. Admin endpoints (brief 123 Phase 2) bypass `requireClubRole`, which is correct — those run as the platform admin, not as the impersonated user, so there's nothing to log here.

---

## 3. New audit row kind: `impersonated_action`

Extends the existing `platform_admin_audit.action` enum from brief 123 §9. Full set becomes:

- `impersonate` — brief 123, session start (unchanged)
- `comp_plan` — brief 123, plan override
- `suspend` / `unsuspend` — brief 123
- `grant_platform_owner` / `revoke_platform_owner` — brief 123 Phase 2
- **`impersonated_action`** — new, this brief

Row shape stays within the existing table — no schema migration beyond the enum widening.

### 3.1 `payload` shape for `impersonated_action` rows

```jsonc
{
  "method": "POST",
  "path": "/clubs/5/bulk_email/send",
  "route_pattern": "/clubs/:id/bulk_email/send",       // for aggregations
  "body_summary": {
    // Sanitized — see §4 for rules per endpoint family
    "recipient_count": 182,
    "subject": "November newsletter",
    "has_attachments": false
  },
  "response_status": 200,                               // written after the handler returns
  "resource_affected": {                                // best-effort — populated when the handler can hand it back
    "kind": "bulk_email_batch",
    "id": 7421
  }
}
```

The handler decorates the audit row with `response_status` + `resource_affected` after it completes. If the handler errors, write `response_status` = the HTTP code and leave `resource_affected` null.

---

## 4. Payload sanitization

**Non-negotiable: no secrets, no PII in the audit `payload`.** The audit log is readable by every platform admin (that's its purpose) — treat it as a semi-public artifact and never store fields that could be weaponised if leaked.

Per endpoint family:

| Endpoint family | Logged | Redacted / omitted |
|---|---|---|
| Bulk email send | `recipient_count`, `subject`, `has_attachments`, `audience_label` | Email body HTML, recipient addresses, from-name |
| Member mutate | `member_id`, `fields_changed` (array of field names only) | Field values (names, phone numbers, DOBs) |
| Page publish | `page_slug`, `block_count` | Block content |
| Venue booking mutate | `booking_id`, `status_from`, `status_to`, `amount_cents` | Member name/email/notes |
| Settings mutate | `setting_group`, `fields_changed` | Any field values (Stripe keys, secrets, API tokens) |
| Stripe action | `stripe_action` (checkout / portal / refund), `amount_cents` | Full charge IDs are fine; customer PII is not |

Default policy for endpoint patterns not in the table above: log method + path + `body_field_names` (array of top-level keys only) and NO values. Opt-in to richer logging per endpoint as we encounter them.

---

## 5. Retention

- Default: **365 days**, matching the existing `platform_admin_audit` retention policy (set in brief 123 §9, 12-month row-level TTL).
- Hard-delete on expiry. No soft-delete — the audit log is a privacy liability as it ages without being useful for operations.
- If regulators ever ask us for "all admin access to account X" that pre-dates 365 days, we tell them truthfully it's not retained. Document this in the privacy policy update that lands with brief 08.

---

## 6. `GET /admin/audit` extensions

No new endpoint. The existing reader (brief 123 §6.5) already exposes `filter[action]` which now accepts `impersonated_action` as an additional value.

**New filter worth adding:** `filter[session_id]` — groups all per-action rows belonging to one impersonation session. The session id is the row id of the parent `impersonate` row. Server joins on `payload->>'impersonation_session_id'` or adds a dedicated column — backend's call on representation. FE wants to be able to click "show all actions in this session" from any `impersonate` row in the log.

Response row shape for `impersonated_action` extends the existing shape from brief 123 §6.5:

```jsonc
{
  "id": 1822,
  "at": "2026-11-26T01:45:12.000Z",
  "action": "impersonated_action",
  "actor": { "user_id": 53, "email": "nev@torny.co", "name": "Neville Rodda" },
  "target_club": { "id": 5, "name": "Naenae Bowling Club", "subdomain": "naenae-bowling-club" },
  "target_user": { "id": 1111, "email": "nigel@torny.co" },
  "reason": null,                              // null on action rows
  "session_id": 1821,                          // NEW — links back to the impersonate row
  "payload": { /* §3.1 shape */ },
  "ip": "202.37.71.10",
  "user_agent": "Mozilla/5.0 …"
}
```

---

## 7. FE surfaces (specced for later — not in backend scope)

Not part of the backend ship, listed here so the backend knows the shape has to accommodate these:

- **Admin portal** `/admin/audit` list — already exists from brief 123. Filter dropdown gains an `impersonated_action` option. Session grouping via the new `session_id` column.
- **Account detail timeline** (brief 123 §3) — `impersonated_action` rows do NOT appear on the per-account timeline by default (they'd swamp the signal). The existing `impersonated` session-start row stays; a "show session actions" expander on that row fetches the matching `session_id` rows and inlines them.
- **During impersonation**, show a quiet action counter in the impersonation banner ("5 actions this session") so the admin has live feedback on their footprint. FE change only, reads from `GET /admin/audit?filter[session_id]=<current>`.

---

## 8. Related product decisions (NOT in this brief's scope)

Flagging adjacent asks the team may want to decide separately:

- **Notify the real owner on impersonation.** Templated email to the owner at session start: "Torny support accessed your account at 14:32 for reason: '<reason>'. Session expires at 14:47." Builds trust; defensible under GDPR / NZ Privacy Act. Separate brief if we go for it — would plumb through brief 40's `sendClubEmail`.
- **Session-scoped read-only mode.** An admin ticks a "read only" box at session start; backend rejects every mutating call with `409 impersonation_read_only`. Lower-risk flow for most support tickets where we just need to see what the owner is seeing. Nice to have, not required for the audit model.
- **Scarier confirmations during impersonation for destructive actions.** Pure FE — bulk email send, member delete, Stripe refund all surface a "You are acting as <email>. Continue?" modal. Independent of this brief.

---

## 9. Verification checklist

Before marking shipped:

- [ ] Start an impersonation session on account 5 (Naenae), make a member edit as the impersonated owner, then stop
- [ ] `GET /admin/audit?filter[session_id]=<the impersonate row's id>` returns the member edit row with `action: impersonated_action`
- [ ] The row's `payload.method` is `PATCH`, `payload.path` is the member endpoint, `payload.body_summary.fields_changed` lists the fields but NOT their values
- [ ] `GET /admin/audit?filter[action]=impersonated_action` lists all impersonated_action rows across sessions
- [ ] A mutation during impersonation that returns `409 account_suspended` (hit a suspended club) still writes the audit row with `response_status: 409` so we have a trail of "admin attempted to do X while account was suspended"
- [ ] Audit write failure (simulated by flipping a feature flag) does NOT fail the underlying mutation — the user still sees success, CloudWatch logs the audit miss
- [ ] Sanitization spot-checks: send a bulk email during impersonation, confirm the recipient addresses + body HTML are NOT in the audit row's payload
- [ ] Platform owner JWT without `impersonated_by` → zero audit rows written for the mutation (we're not doubling up on normal admin usage)
- [ ] Non-mutation GETs during impersonation → zero audit rows (we're not swamping the log with reads)

---

## 10. Non-goals

- **Logging read endpoints during impersonation.** We'd generate 100× the row volume for marginal value. If "which pages did the admin view during session X" ever becomes a real need, ship it as a separate opt-in.
- **Real-time admin notifications on impersonation activity.** The audit log is pull-based; if a platform owner wants to monitor what a teammate is doing, they query. Push-based "admin X just suspended account Y" is a different product (and would probably want to live in a Slack webhook, not the CRM UI).
- **Replay / undo.** Audit rows describe what happened; they don't carry enough fidelity to automatically reverse the action. "Undo the email I just sent as the owner" requires separate infra (email callback, Stripe refund flow, etc.) — not in scope.
- **PII-containing payloads.** Firmly out. If support ever needs the content of an action to resolve a ticket, they go to the primary table (e.g. `email_batches` for a bulk send) — those tables already have appropriate per-row access controls.

---

## 11. Contact

Nev on #torny-eng. FE wiring (filter dropdown, session grouping on the audit list, banner action counter) is ready to ship the day this backend lands.

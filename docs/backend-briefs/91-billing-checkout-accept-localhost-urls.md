# Brief 91 — `POST /clubs/:cid/billing/checkout` + `/billing/portal`: accept `http://localhost:*` URLs in addition to `https://*`

**Scope:** VENUE_BASE · `POST /clubs/:cid/billing/checkout` and `POST /clubs/:cid/billing/portal`
**Blocks:** local dev of Settings → Billing in the CRM. Prod is unaffected.

---

## 1. The ask

Relax the URL validator on these two endpoints so that `http://localhost:<port>/…` is accepted for `success_url`, `cancel_url` (checkout) and `return_url` (portal), in addition to the current `https://…` requirement.

That's it. One rule, two endpoints.

---

## 2. Why

The CRM dev server runs on `http://localhost:5174`. When an admin tests the "Upgrade to Pro" flow locally, the FE sends:

```json
{
  "plan": "pro",
  "success_url": "http://localhost:5174/settings?tab=billing&result=success",
  "cancel_url":  "http://localhost:5174/settings?tab=billing&result=cancel"
}
```

The endpoint currently 400s with:

```json
{ "status": "error", "code": "invalid_url_scheme",
  "message": "success_url and cancel_url must be https" }
```

So the full Checkout flow can't be exercised in dev. We get as far as rendering live plan state (✓) but can't actually test the handoff to Stripe or the round-trip back.

**Stripe itself already allows `http://localhost` for these URLs in test mode** — see [Stripe Checkout docs → success_url](https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-success_url). So the stricter check on our side is more restrictive than the thing we're wrapping, with no security benefit (Stripe hosts the payment page — we're only validating the return URL).

---

## 3. Suggested validator shape

```
Accept URL U if:
  (U.scheme == "https")                        — existing prod rule, unchanged
  OR (U.scheme == "http" AND U.hostname == "localhost")   — new, dev only
Reject everything else.
```

Notes:

- `U.hostname == "localhost"` is the full match — don't match `127.0.0.1` unless you want to (we don't need it). Loose matching like "contains localhost" invites abuse.
- No env-var gate. The rule is the same in dev and prod — prod URLs are already HTTPS, so the new branch never fires in prod. One codepath, less to go wrong.
- Keep the `invalid_url_scheme` error code and message for truly invalid cases (any other `http://` host, non-http schemes, etc.).

---

## 4. Endpoints to update

Both introduced in brief 87:

| Endpoint | Fields to re-validate |
|---|---|
| `POST /clubs/:cid/billing/checkout` | `success_url`, `cancel_url` |
| `POST /clubs/:cid/billing/portal`   | `return_url` |

Same rule on all three fields.

---

## 5. Verification

```bash
# 1. Dev admin — localhost accepted
curl -X POST "$VENUE_BASE/clubs/42/billing/checkout" \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -d '{"plan":"pro",
       "success_url":"http://localhost:5174/settings?tab=billing&result=success",
       "cancel_url": "http://localhost:5174/settings?tab=billing&result=cancel"}'
# → 200, data.checkout_url is a stripe.com URL

# 2. Prod shape still works
curl -X POST "$VENUE_BASE/clubs/42/billing/checkout" \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -d '{"plan":"pro",
       "success_url":"https://crm.torny.co/settings?tab=billing&result=success",
       "cancel_url": "https://crm.torny.co/settings?tab=billing&result=cancel"}'
# → 200

# 3. Non-localhost http still rejected
curl -X POST "$VENUE_BASE/clubs/42/billing/checkout" \
  -d '{"plan":"pro",
       "success_url":"http://evil.example.com/...",
       "cancel_url": "http://evil.example.com/..."}'
# → 400 invalid_url_scheme

# 4. Portal, same rule
curl -X POST "$VENUE_BASE/clubs/42/billing/portal" \
  -d '{"return_url":"http://localhost:5174/settings?tab=billing"}'
# → 200
```

---

## 6. Non-goals

- Not asking for a dev-only env flag. The rule should be universal — prod doesn't care because prod URLs are already HTTPS.
- Not asking for `127.0.0.1`, `0.0.0.0`, or `*.local` support. `localhost` only.
- No FE change required — the FE already sends `window.location.origin`, which is correct in both dev (`http://localhost:5174`) and prod (`https://crm.torny.co`).

---

## 7. Once this ships

I'll:

1. Run checkout + portal end-to-end from the local CRM against test-mode Stripe.
2. Confirm the `?result=success` / `?result=cancel` round-trip repopulates the Billing panel.
3. Close this brief.

# Brief 92 — Stripe Customer Portal missing "Switch plans" row

**Scope:** Stripe Dashboard config, not code.
**Follow-on to:** brief 87 §3 (which already specified this but it looks like it was missed in the Dashboard setup).

---

## 1. What's happening

An admin on **Pro** clicks "Switch to Starter" on Settings → Billing. The FE opens the Stripe Billing Portal (correct — brief 87 §3 said plan changes go through the Portal, not a fresh Checkout). The Portal loads, but there's no "Switch plans" option — only **Cancel subscription**, payment method management, and invoice history.

Screenshot from the Sandbox mode Portal:

- ✓ Current subscription shown
- ✓ Cancel subscription button
- ✓ Payment method card
- ✓ Invoice history
- ✗ **No plan-switching row**

So the Portal is configured, but the plan-switching feature isn't turned on.

---

## 2. Root cause

Brief 87 §3 called this out explicitly:

> Stripe Customer Portal config (one-time in the Stripe dashboard): allow plan switching between Starter + Pro, enable cancellation (effective at period end), enable invoice history, allow updating payment method.

That toggle wasn't flipped when the Portal was set up. The other three features landed; this one didn't.

---

## 3. The fix — Stripe Dashboard, ~2 minutes

1. **Stripe Dashboard → Settings → Billing → Customer Portal** (left nav; the URL ends `/settings/billing/portal`).
2. Make sure you're in the right mode — **Sandbox / Test mode** for dev/staging, **Live mode** for prod. Both need the same config.
3. Under **Subscriptions**, enable **"Customers can switch plans"**.
4. Under **Products**, add both products to the allowed-switch list:
   - Torny Starter (`$39 / month`)
   - Torny Pro (`$79 / month`)
5. **Proration behaviour:** `Create prorations` (default). Downgrading Pro → Starter mid-cycle credits the unused Pro time. Upgrading Starter → Pro charges the prorated difference.
6. **Billing cycle:** keep `Remain on current billing cycle` so switching doesn't reset the trial or the next-charge date.
7. Click **Save**.

Repeat for both **Test mode** and **Live mode**.

---

## 4. Verify

```
# Any Pro-subscribed sandbox club:
1. Settings → Billing → "Switch to Starter"
2. Portal loads
3. "Switch plans" row appears above "Cancel subscription"
4. Click it → picker shows Starter + Pro
5. Pick Starter → confirmation screen → Confirm
6. Stripe webhook customer.subscription.updated fires
7. Backend re-derives plan from the new price ID (brief 87 §6 webhook table — this already works)
8. Admin lands back on /crm/settings/billing; refresh shows plan='starter', subscription_status='active'
```

No code change needed on either side — the FE already routes to the Portal, the backend webhook already handles the plan swap.

---

## 5. Why this matters

Without the switch row, admins can only cancel — they can't move Pro → Starter. A cancellation ends the subscription entirely, which is worse than downgrading for revenue retention. Any Pro admin who wants to save money will churn instead of downgrading.

Same logic applies to Starter admins who might want to try Pro — Checkout handles the first-time flow, but once they have a Stripe customer, in-Portal upgrades are the smoother path.

---

## 6. Non-goals

- Not rebuilding plan switching in-app. The Portal is the authoritative UI (brief 87 §3.4).
- Not adding a separate `change-plan` endpoint. The webhook already catches the swap.

---

## 7. Once this ships

Ping me and I'll:
1. Verify both directions (Pro → Starter + Starter → Pro) end-to-end in Sandbox.
2. Confirm the FE's `billingState.plan` + `subscription_status` reflect the new values after the webhook.
3. Close this brief.

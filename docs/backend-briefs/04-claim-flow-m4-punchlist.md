# Backend brief — Claim flow M4 punchlist

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` (Vue 3 SPA)
**Depends on:** [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) is the authoritative contract. This brief is the frontend integration checklist — what specifically is mocked today, what M4 has to deliver for the frontend to un-mock it, and the open questions the frontend can't answer alone.

---

## TL;DR

- **Auth (M1) is live and wired** — sign-in, register, password reset all hit real endpoints today (brief 03).
- **Directory search is live** — used in claim wizard step 1, unchanged from before.
- **Claim submission and admin review are still fully mocked in the frontend.** Every seam is ready to swap; we're blocked on backend M4.
- **The frontend does not want to build against `/create-claim` or the mobile-legacy claim endpoints.** Wait for the M4 endpoints in brief 01 §4 + §6.

---

## What's mocked today (files, functions, and the seams to replace)

Every one of these has a clean seam. When M4 lands the swap is small — no refactor needed.

| Area | File | What's mocked |
| --- | --- | --- |
| Claim submission | `apps/crm/src/views/auth/ClaimClubView.vue` → `submitClaim()` | 600 ms fake `setTimeout` before jumping to the "we got it" screen. No API call. |
| Claim queue (platform admin) | `apps/crm/src/stores/claims.ts` | Seeded in-memory array, mutated locally on approve/reject. |
| Approve / reject actions | `apps/crm/src/views/admin/AdminClaimsView.vue` | Calls the mock store; no API. |
| "My claims" status screen | *(not yet built)* | Frontend needs `GET /claims/mine` to render the post-submit "pending review" screen once the user re-signs-in. |

**Search + select in the claim wizard step 1 stays as-is** — it hits the live directory API and does not depend on M4.

---

## Endpoints the frontend needs from M4

All contract details are in brief 01. Repeated here in call order so backend can tick them off, and the frontend can un-mock them one at a time.

1. `POST /claims` — brief 01 §4.2. Called from `ClaimClubView.vue` step 2 submit. The frontend already collects everything the request needs (`directoryClubId`, evidence text, role-at-club) — nothing new to design.
2. `GET /claims/mine` — brief 01 §4.3. Used to render the "your submitted claim is pending" screen when a user with no `clubs[]` and a pending claim signs in.
3. `GET /admin/claims?status=pending` — brief 01 §6.1. Populates `AdminClaimsView.vue`.
4. `POST /admin/claims/:id/approve` — brief 01 §6.2. **Side effects (§6.2 steps 1–6) are non-negotiable** — the frontend assumes an approve returns a `clubId` and that the claimant's `clubs[]` will be populated on their next sign-in. Without that, the post-approval sign-in loop breaks.
5. `POST /admin/claims/:id/reject` — brief 01 §6.3. Reason is shown verbatim in the rejected-status screen and the email; keep it as user-facing prose.

Note: `role_at_club` in the frontend UI (labelled "What's your role at the club?") maps to `role` in the `POST /claims` body per brief 01 §4.2.

---

## Frontend-specific integration notes

A few things worth calling out that brief 01 doesn't cover because they're client-side concerns:

**1. Post-submit navigation.** After `POST /claims` returns 201, the frontend routes to a "pending review" screen inside the claim wizard (step 3). It does **not** sign the user out — but the user has no `clubs[]` yet, so on next sign-in they'll land on `/claim` again. The wizard needs to detect an existing pending claim via `GET /claims/mine` and skip straight to the "pending review" state rather than re-showing the search step. That's why `/claims/mine` is on the punchlist even though brief 01 lists it as a secondary endpoint.

**2. Post-approve sign-in.** When a claim is approved, the frontend expects the claimant's next login to return `role: "owner"` and a populated `clubs: [{ id, role: "owner" }]`. Landing page routing in `SignInView.vue` reads `user.role` and either sends `owner` → `/crm/dashboard` or `player` → `/claim`. If the approve side effects in brief 01 §6.2 step 3 don't fire correctly, an approved user will loop back to `/claim` on sign-in — silently and confusingly.

**3. Auto-reject sibling claims.** Brief 01 §6.2 step 4 auto-rejects other pending claims on the same directory club. The claimants of those siblings then see `status: "rejected"` on their next `GET /claims/mine` call. The rejection reason (`"Club already claimed by another admin."`) is shown verbatim in the UI — make sure the copy is user-friendly, or expose a machine-readable reason code (e.g. `code: "sibling_approved"`) so the frontend can substitute better wording.

**4. Directory 404 at approve time.** Brief 01 §11 flags this at *submit* time (→ 422). Same case at *approve* time: if the SAM directory 404s the cached `directoryClubId` between submit and approve, the frontend needs a distinct error to render on the admin queue rather than a generic 500. Suggest `409 { code: "directory_unavailable" }` and a "retry" button on the frontend.

**5. Cache the directory snapshot on the claim row.** Brief 01 §4.2 already specifies this. Just noting: the frontend depends on it — `GET /admin/claims` should return `clubName`, `region`, `sport` from the snapshot, not by re-hitting the directory API per claim.

---

## Open questions the frontend can't answer alone

- **Does `POST /register` return a session token?** Today's mobile-legacy `/register` (brief 03 §2) doesn't. If M4 keeps that behaviour, the claim wizard needs to explicitly `POST /login` after register before it can submit a claim. If M4 changes `/register` to return a token, the wizard can skip the extra login. Not blocking — but let us know so we build one flow, not both.
- **Rate limit on `POST /claims`.** Brief 01 §9 says 5/hour/user. What's the response shape when this trips? Frontend needs `429 { code: "rate_limited", retryAfterSeconds: N }` or equivalent to show a useful message.
- **Can a rejected claimant re-submit for the same club?** Brief 01 §4.1 says yes (new claim row). Confirm the frontend can just re-POST to `/claims` with the same `directoryClubId` after their previous one was rejected — no special endpoint needed.
- **What happens if the user submits, gets approved, then somebody bans their account?** Out of scope for M4, but flag it — brief 01 §11 hints at it. The frontend has no way to know today.

---

## Acceptance criteria — what "done" looks like for the frontend

The frontend can un-mock the entire claim flow once **all** of these are true:

- [ ] `POST /claims` returns 201 with the shape in brief 01 §4.2, and fires `claim.submitted` email.
- [ ] `GET /claims/mine` returns pending / approved / rejected claims for the caller.
- [ ] `GET /admin/claims?status=pending` returns the shape in brief 01 §6.1, sorted `submittedAt DESC`.
- [ ] `POST /admin/claims/:id/approve` returns the shape in brief 01 §6.2, side-effects fire atomically, and the claimant's next `POST /login` returns `role: "owner"` with a non-empty `clubs[]`.
- [ ] `POST /admin/claims/:id/reject` returns the shape in brief 01 §6.3 and fires `claim.rejected` email with the reason inlined.
- [ ] Error responses use the shape in brief 01 §6.4 (`code` field on 4xx).

When all six are green, this is a ~half-day frontend job to swap the mocks — no refactor.

---

## Suggested build order

1. `POST /claims` + `GET /claims/mine` — unblocks the claimant-side wizard end-to-end.
2. `GET /admin/claims` — unblocks the admin queue as a read-only view.
3. `POST /admin/claims/:id/approve` including all six side effects. **This is the risky one** — the atomic transaction and the `clubs[]` propagation both need to be right or the whole flow silently breaks.
4. `POST /admin/claims/:id/reject` including auto-reject-siblings side effect.
5. Ping the frontend once all four are on staging — we'll walk it end-to-end together.

---

## Frontend contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`. Happy to jump on a call if the atomic side effects in §6.2 need pairing.

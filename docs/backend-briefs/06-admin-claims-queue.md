# Backend brief — Admin claim queue endpoints

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` platform admin console
**Depends on:** [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) §6 (contract) and [04-claim-flow-m4-punchlist.md](./04-claim-flow-m4-punchlist.md) (broader punchlist).
**Status:** Frontend admin queue is fully built and polished. Every seam is ready. Waiting on three endpoints from M4.
**Owner:** Neville Rodda (`nev@torny.co`)

---

## 1. Scope

This brief covers **only the platform-admin side** of the claim flow — list, approve, reject. The claimant-side endpoints (`POST /claims`, `GET /claims/mine`) are covered in brief 04 and are also part of M4, but the admin queue can be wired independently once these three endpoints land.

If backend can only land part of M4, land these three first — they unblock the entire `/admin/claims` screen and let the platform team demo the moderation flow end-to-end.

---

## 2. What the frontend already does

Fully working admin queue at `/admin/claims` (`apps/crm/src/views/admin/AdminClaimsView.vue`), gated by `is_platform_admin: true`. **All UI is production-ready** — only the data source is mocked.

**Working today:**
- Summary strip (pending count / waiting >2 days / average wait / decided all-time)
- Status tabs (Pending / Approved / Rejected) with counts
- Search across club name, region, sport, claimant name, email, role
- Sport-coded badges per claim (bowls, tennis, golf, cricket, pétanque, croquet)
- Urgency indicator (orange left border + "Waiting Nd" badge) for claims pending ≥2 days
- Expandable row → shows claimant, club, submission timeline, evidence, rejection reason
- Approve button → calls `claims.approve(id, decidedBy)`
- Reject flow → modal with reason field → calls `claims.reject(id, decidedBy, reason)`
- Deep linking (`/admin/claims#clm_001` opens that row expanded)
- Empty states per tab

**The seam to swap:** `apps/crm/src/stores/claims.ts`. It's a Pinia store with an in-memory `claims: Claim[]` and `approve` / `reject` functions that mutate it. Replace the three methods below with real API calls and the entire UI comes live.

---

## 3. Endpoints needed

Full contract in [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) §6. Recap here in call order with frontend-specific notes.

### 3.1 List claims

```
GET /admin/claims?status=pending&limit=50&cursor=…
Authorization: Bearer <platform-token>
```

**Frontend usage:** called on mount of `AdminClaimsView.vue`, plus refetch when the active tab changes.

**Response shape** — brief 01 §6.1 already specifies. Confirming the fields the frontend reads:

```json
{
  "claims": [
    {
      "id": "clm_01H...",
      "status": "pending",
      "clubId": 12,
      "clubName": "Kelburn Bowling Club",
      "region": "Wellington",
      "sport": "bowls",
      "claimant": {
        "id": "usr_01H...",
        "firstName": "Marcus",
        "lastName": "Tuilagi",
        "email": "marcus.t@kelburnbowls.co.nz",
        "role": "Secretary"
      },
      "evidence": "…",
      "submittedAt": "2026-08-19T14:22:00Z",
      "decidedAt": null,
      "decidedBy": null,
      "rejectionReason": null
    }
  ],
  "nextCursor": null
}
```

Frontend-specific asks:
- **`sport` must be the string code** — `bowls | tennis | golf | cricket | petanque | croquet`. Not the numeric enum from the directory API. Brief 01 §5 already specifies this mapping; just confirming the admin queue depends on it.
- **`region` and `clubName` must come from the snapshot on the claim row**, not by re-hitting the directory API per claim. Directory can 404 by the time an admin reviews.
- **`decidedAt` / `decidedBy` / `rejectionReason` are always returned** on approved and rejected claims (null on pending). The frontend renders them unconditionally in the expanded detail.
- **Status filter accepts `pending | approved | rejected` or `all`** (or omitted). Frontend calls once per tab today, but if you support `all` we could switch to one client-side split.
- **Sort:** `pending` by `submittedAt DESC`, `approved` and `rejected` by `decidedAt DESC`. Frontend re-sorts client-side too but server-side ordering is cheaper on scroll.
- **Cursor pagination.** Frontend fetches 50 at a time; we'll show a "Load more" button when `nextCursor` is present. Do not switch to offset.

### 3.2 Approve

```
POST /admin/claims/:id/approve
Authorization: Bearer <platform-token>

{}
```

**Frontend usage:** called from the Approve button in the expanded row detail. Optimistic — the local claim gets `status: 'approved'` on click and rolls back on error.

**Response shape** — brief 01 §6.2:

```json
{
  "id": "clm_01H...",
  "status": "approved",
  "decidedAt": "2026-08-20T09:10:00Z",
  "decidedBy": "Neville Rodda",
  "clubId": "clb_01H..."
}
```

Frontend-specific asks:
- **Return the new `clubId`** — the frontend doesn't need it today, but the ops flow eventually will (e.g. a "view provisioned club" link on the approved row). Cheap to include now.
- **`decidedBy` should be the human-readable full name** of the reviewing admin (not just email). Frontend uses it verbatim in the audit trail line.
- **Side effects (brief 01 §6.2 steps 1-6) must be atomic.** Any single failure = rollback. If the frontend gets a 200 back, it assumes the club was provisioned, the claimant is now `owner`, sibling claims are auto-rejected, and emails have fired. Do not partially succeed.
- **Confirm auto-reject side-effect shape.** Sibling claims that get auto-rejected — do they appear in the next `GET /admin/claims?status=rejected` call with `rejectionReason: "Club already claimed by another admin."` or a machine-readable `code: "sibling_approved"`? Frontend prefers the code so we can substitute custom copy without string-matching.

### 3.3 Reject

```
POST /admin/claims/:id/reject
Authorization: Bearer <platform-token>

{
  "reason": "We couldn't verify your role — please attach recent committee minutes and re-submit."
}
```

**Frontend usage:** called from the "Reject & notify" button in the reject modal. Reason field is required (frontend already enforces 10+ chars, matching brief 01 §6.3).

**Response shape** — brief 01 §6.3. Confirmed. Nothing extra needed.

### 3.4 Error responses

Frontend expects the shapes from brief 01 §6.4:

| Case | Response | Frontend behavior |
| --- | --- | --- |
| Claim not found | `404` | Toast "This claim no longer exists" + refetch list |
| Claim already decided | `409 { code: "already_decided" }` | Toast "Someone else got there first" + refetch |
| Approve when club already claimed | `409 { code: "club_already_claimed" }` | Modal: "Another admin claimed this club — auto-reject siblings?" |
| Non-platform-admin calls admin route | `403 { code: "forbidden" }` | Redirect to `/forbidden` |
| Rate limited | `429 { retryAfterSeconds: N }` | Disable button + "Try again in Ns" toast |

The `code` field is not optional — the frontend switches on it to pick the right toast copy. Please include it consistently.

---

## 4. Wire-up plan (frontend side, for context)

When the three endpoints land, the frontend swap looks like this. Sharing so backend can sanity-check the direction:

1. **`packages/api-client/src/resources/admin-claims.ts`** — new resource module with `list`, `approve`, `reject` functions using the shared `TornyClient` (auth token attached automatically).
2. **`apps/crm/src/stores/claims.ts`** — replace the seeded array with a fetch on load, replace `approve` / `reject` mutations with awaited API calls that update local state on success + throw on error.
3. **`AdminClaimsView.vue`** — add a loading skeleton (data comes from network now), surface API errors via toast + retry.

Total swap: ~half a day. No visual changes.

---

## 5. Acceptance criteria — what "done" looks like

The frontend can un-mock the admin queue when **all** of these are true:

- [ ] `GET /admin/claims?status=pending` returns a valid page of pending claims sorted `submittedAt DESC`, with `sport` as a string code and `clubName`/`region` snapshotted.
- [ ] `GET /admin/claims?status=approved` and `?status=rejected` work with `decidedAt DESC`.
- [ ] `POST /admin/claims/:id/approve` returns 200 with the shape in §3.2, side effects fire atomically, and the claimant's next `/login` returns `role: "owner"` with populated `clubs[]`.
- [ ] `POST /admin/claims/:id/reject` returns 200 with the shape in §3.3, fires `claim.rejected` email with the reason inlined.
- [ ] Sibling claims auto-rejected on approval carry `rejectionReason` (verbatim or via a `code` we can substitute — either is fine, just be consistent).
- [ ] Error responses use the `code` field per §3.4.
- [ ] Only callers with `is_platform_admin: true` succeed; anyone else gets 403.

When all seven are green, this is a ~half-day frontend swap.

---

## 6. Test accounts / seed data

For staging: we'd love 6-8 seeded pending claims spread across sports (bowls, tennis, golf minimum) and regions, plus 2-3 decided ones (approved + rejected) so the admin queue has realistic content to click through before real user traffic arrives. Frontend has a matching seed today in `stores/claims.ts` if that helps as a starting point.

---

## 7. Priority

- **P0** for M4: land §3.1 (list). Without it the admin queue is a blank page.
- **P0** for M4: land §3.2 (approve) with all six side effects atomic. This is the risky endpoint per brief 04 §Suggested build order.
- **P0** for M4: land §3.3 (reject). Simplest of the three — nail it while you're in the code.
- **P1**: sibling auto-reject `code` field. Not blocking — we can string-match if needed.
- **P1**: seed data on staging (§6).

---

## 8. Contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`. Happy to pair through the atomic approve transaction if useful.

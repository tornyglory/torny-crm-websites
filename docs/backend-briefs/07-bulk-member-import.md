# Backend brief — Bulk member import

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` — Members page, new bulk import flow
**Depends on:** [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) (users + club_members model)
**Related but distinct:** [02-team-access.md](./02-team-access.md) (that's CRM-role invites — this brief is player-level members, much higher volume)
**Status:** Ready to design. Frontend will build the UI + mock the preview API while backend confirms shape.
**Owner:** Neville Rodda (`nev@torny.co`)

---

## 1. Why this matters

A club owner claiming Torny arrives with a member list that's already 50–200 people. Manually adding them one-by-one via the "+ Add member" form is a non-starter. The killer feature for onboarding is: **drop a spreadsheet → members appear**.

There's a twist that makes this more valuable than a simple CRUD bulk-insert: **many of those members may already be Torny users** via the native mobile app. Getting a linked profile (avatar, sport history, contact prefs) instead of a stub row is a big data-quality win.

So the flow isn't "bulk create members" — it's **"bulk match, link, or invite"**.

---

## 2. How this differs from brief 02 (team access)

Same shape (upload a list of people), different domain:

| | Brief 02 — Team access | This brief — Members |
| --- | --- | --- |
| Grants | CRM access (`owner`/`admin`/`committee`) | Player-level membership only (no CRM access) |
| Row count | 1-10 people | 50-500 people |
| Table | `club_members` with a CRM role | `club_members` with role `player` |
| Verification | Every invite is a manual decision | Bulk trust: owner asserts these are their members |
| Notification | Always email invite | Push notification if existing Torny user, email if not |
| Consent model | Invitee must accept before joining | Auto-link if the user is already on Torny; opt-in for new signups |

They should share the underlying `club_members` table (per brief 01 §8) but the routes and UX are separate.

---

## 3. Data model — what needs to be true

Extends brief 01 §8:

```
club_members
  ...brief 01 §8...
  source ENUM('claim','invite','bulk_import','self_signup') NOT NULL,
  import_batch_id FK NULLABLE,        -- links to the import that added this row

member_imports
  id, club_id FK, uploaded_by_user_id FK,
  original_filename, row_count,
  matched_count, invited_count, error_count,
  status ENUM('preview','committed','cancelled'),
  created_at, committed_at NULLABLE
```

The `source` enum lets us report on how a club's roster was built — critical for support ("why is this member here? oh, they came from a bulk import on 3 Aug").

---

## 4. Match logic — what backend must do per CSV row

Given a row `{ email?, phone?, firstName, lastName, dob?, membershipType?, ... }`:

1. **Email match** (case-insensitive, whitespace-trimmed) → `users.email` → if hit, this is the target user.
2. **Phone match** — normalize to E.164, match on `users.phone` → if hit, this is the target user.
3. **No match** → **new user path** (see §5).

If step 1 and step 2 both find users **but different ones** → return a `code: "conflict"` for that row; frontend surfaces it to the owner for manual resolution.

**Fuzzy name+DOB match** (P2, later) → when email and phone are absent, first name + last name + DOB within same region could suggest a match. Return `possibleMatch: { userId, confidence }` and let the owner opt-in per row. Not blocking — skip for MVP.

Every matched user then falls into one of three states:

- **Already in this club** (`club_members` row exists, not revoked) → status `skipped`, no action.
- **Not in this club** → status `linked`, insert a `club_members` row with `role: 'player'`, `source: 'bulk_import'`.
- **Was in this club but revoked** → status `relinked`, un-revoke the old row (per brief 02 §12 open question — either resurrect or new row; we assume **resurrect** for imports to preserve `joined_at`).

---

## 5. New-user path — invite or create-stub

For rows with no match, the owner picks the strategy **once for the whole import** (preview step in UI):

**Option A — "Invite them to join"** (default)
- Backend creates a pending `member_invites` row (or reuses `club_invites` from brief 02 with a `role: 'player'` value; TBD which table).
- Fires an email: "Grace Whittaker added you to Naenae Bowling on Torny. Sign up to see your membership."
- Row status: `invited`.
- On acceptance: user record + `club_members` row are created atomically.

**Option B — "Just add them, no invite"**
- Backend creates a `users` row with `email_verified_at = NULL`, `password_hash = NULL`.
- Creates the `club_members` row immediately.
- The member exists in the CRM but can't sign in until they claim the account (future flow — trigger by password-reset request against their email).
- Row status: `stub_created`.
- Use case: clubs that don't want to spam existing members with "we've moved systems" emails; they'll message their members separately.

Frontend must let the owner pick A vs B on the preview screen before committing.

---

## 6. Endpoints

### 6.1 Preview

```
POST /clubs/:clubId/members/import/preview
Authorization: Bearer <owner-or-admin>
Content-Type: application/json

{
  "rows": [
    {
      "rowNumber": 2,        // 1-indexed line number from the CSV (skipping the header)
      "email": "aroha@example.com",
      "phone": "+64211234567",
      "firstName": "Aroha",
      "lastName": "Ngata",
      "dob": "1992-03-14",
      "membershipType": "Playing member"
    },
    ...
  ],
  "newUserStrategy": "invite" | "stub"
}
```

**Response (200):**

```json
{
  "importId": "imp_01H...",         // TTL 1 hour — must commit within this
  "summary": {
    "totalRows": 84,
    "willSkip": 3,
    "willLink": 32,
    "willRelink": 1,
    "willInvite": 42,
    "willStub": 0,
    "errors": 6
  },
  "rows": [
    {
      "rowNumber": 2,
      "email": "aroha@example.com",
      "displayName": "Aroha Ngata",
      "resolution": "linked",       // linked | relinked | skipped | invited | stub_created | error
      "matchedUserId": "usr_01H...",
      "matchedVia": "email",         // email | phone | none
      "existingAvatar": "https://…", // for linked/skipped rows
      "error": null
    },
    {
      "rowNumber": 15,
      "email": "not-an-email",
      "displayName": "Sam Harding",
      "resolution": "error",
      "error": { "code": "invalid_email", "message": "\"not-an-email\" is not a valid email address" }
    },
    ...
  ]
}
```

Frontend renders the summary + row-by-row table on the preview screen. `importId` gets sent back on commit.

**Batch size:** frontend will chunk uploads to ≤500 rows per preview call. Larger CSVs get split client-side and reconciled after commit.

### 6.2 Commit

```
POST /clubs/:clubId/members/import/commit
Authorization: Bearer <owner-or-admin>

{
  "importId": "imp_01H..."
}
```

**Response (200):**

```json
{
  "importId": "imp_01H...",
  "committed": true,
  "actualCounts": {
    "linked": 32,
    "relinked": 1,
    "invited": 42,
    "stubCreated": 0,
    "skipped": 3,
    "failed": 0
  },
  "notificationsFired": {
    "pushSent": 32,
    "emailsSent": 42
  }
}
```

- If any row fails during commit (e.g. race condition — a user signed up between preview and commit), that row gets `failed` and the rest still commit. Frontend refetches the member list and shows a "3 rows didn't apply — retry?" toast.
- Commit is idempotent by `importId`; retrying returns the same result.

### 6.3 Cancel (optional but nice)

```
DELETE /clubs/:clubId/members/import/:importId
```

Explicit cancel — cleans up the staged preview. Not strictly necessary since preview expires in 1h anyway.

### 6.4 History (P2)

```
GET /clubs/:clubId/members/imports?limit=20
```

Returns committed imports so the owner can see "who imported what, when". Useful for support and audit. Skip for MVP.

---

## 7. Notification flow

- **Linked/relinked rows** (existing Torny user got added to a club): fire a push notification via the mobile app — "Grace Whittaker added you to Naenae Bowling. Tap to see your membership." No email — they already have the app and expect push comms from Torny.
- **Invited rows** (new user path A): email — "You've been added to Naenae Bowling on Torny. Set up your account to see your membership."
- **Stub rows** (new user path B): no notification at all. The club is expected to communicate separately.
- **Skipped rows**: no notification.

Push + email templates share the "who added you to what club" context. Include the club logo/name and a deep-link (or web URL for email).

---

## 8. Errors — per row

Preview response's `error.code` values the frontend understands:

| code | Meaning | Frontend UX |
| --- | --- | --- |
| `invalid_email` | Email doesn't match a basic pattern | Row shows red, error text under email cell |
| `invalid_phone` | Phone can't be normalized | Same |
| `duplicate_in_csv` | Same email/phone appears earlier in the CSV | "Duplicate of row N" |
| `missing_required` | No email AND no phone → can't match or invite | "Add email or phone to include this row" |
| `conflict` | Email and phone match different users | Modal to pick which one to link |
| `invalid_dob` | DOB doesn't parse | Warning (not blocking) — DOB is optional |

The commit is allowed to include rows with `resolution: 'error'` — they just get skipped and reported in the response.

---

## 9. Security + limits

- **Route auth:** `owner` or `admin` role on the target club. `committee` cannot bulk-import — that's an owner-level trust move.
- **Rate limit:** 5 commits per club per hour. Preview calls are cheap; don't rate-limit them.
- **PII:** the CSV contains emails, phones, DOBs. Do not log the raw rows — log only counts and IDs.
- **Audit:** every commit writes to the audit log per brief 02 §9 style: `who committed, when, count summary, importId`. Retention ≥ 3 years.
- **CSV size:** cap client-side at 500 rows/preview. Backend can enforce a hard cap of e.g. 1000 rows/preview to protect the API.

---

## 10. Frontend integration plan

Where the frontend will hook in — for context, so backend can sanity-check the shape:

1. **New route:** `/crm/members/import` — a full-page wizard, not a modal (too much data to show in a modal comfortably).
2. **Wizard steps:**
   - Step 1: upload CSV (drag-and-drop, or paste)
   - Step 2: field mapping (map CSV columns → Torny fields; save as default for next time)
   - Step 3: pick new-user strategy (invite vs stub)
   - Step 4: preview — server-driven from §6.1 response; owner reviews summary + row table, can exclude rows
   - Step 5: commit — server-driven from §6.2 response
   - Step 6: success — "84 members added" with breakdown + link back to members list
3. **Entry point:** button on `MembersView.vue` header: "Import from CSV" alongside "+ Add member".
4. **Mock while backend is being built:** frontend will parse the CSV client-side, generate a fake preview response (random resolutions), and let the whole flow work end-to-end so we can UX-test before wireup.

---

## 11. Acceptance criteria

Frontend can un-mock the whole flow when:

- [ ] `POST /clubs/:clubId/members/import/preview` accepts a batch of rows, returns the shape in §6.1, matches on email + phone, tags each row with a resolution and error where applicable.
- [ ] `POST /clubs/:clubId/members/import/commit` idempotently commits the preview and returns the shape in §6.2.
- [ ] `linked` rows appear in subsequent `GET /clubs/:clubId/members` calls; `invited` rows appear in `?includeInvites=true` (per brief 02 §4.1).
- [ ] Push notifications fire for linked/relinked rows; email invites fire for invited rows; no notifications for stub or skipped rows.
- [ ] Errors surface with the `code` values in §8.
- [ ] Only `owner` and `admin` can call these endpoints; `committee` gets 403.
- [ ] Audit log entries written per commit.

---

## 12. Open questions

- **Which table holds invites?** Reuse `club_invites` from brief 02 with a `role: 'player'` value, or a separate `member_invites` table? Suggest reusing `club_invites` and adding the `player` role — smaller surface. Confirm before implementing.
- **How does an "invited" user go from invite → linked when they sign up?** Presumably `POST /invites/accept` (brief 02 §4.5) handles this transparently since it always creates the `club_members` row. Confirm the acceptance flow works for `role: 'player'` invites too.
- **DOB handling.** DOB is optional in the frontend and stored as `NULL` if absent. Any downstream systems that require DOB (e.g. Bowls NZ registration integration, future work) will need to prompt the member later. Flag before that integration.
- **Existing member linking — what if the matched user's mobile phone number differs from the CSV?** Do we update the user record's phone to the CSV value, or keep the mobile-provided one? Suggest **keep** (user's own data wins) and note it in the preview response as `phoneMismatch: true` so the owner knows. Confirm.
- **Re-imports.** If an owner uploads a CSV that overlaps with a previous import, `skipped` rows should be idempotent. But what about "the CSV changed a member's phone" — do we update or ignore? Suggest **ignore in bulk import; edit in single-member flow**. Flag for confirmation.

---

## 13. Priority

- **P0** — §6.1 (preview) and §6.2 (commit). The frontend needs both to build the flow end-to-end.
- **P1** — Push notification integration (§7). If it takes longer, launch with email-only for existing users too and add push later.
- **P2** — Fuzzy name+DOB match (§4), imports history endpoint (§6.4), stub user password-claim flow.

---

## 14. Contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`. Happy to jump on a call to work through the match-logic edge cases if easier.

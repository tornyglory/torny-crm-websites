# Bulk Member Import — Frontend Implementation Brief

**Feature:** the "drop a CSV, watch members appear" flow on the CRM Members page. Owner/admin uploads a spreadsheet of ≤500 members; server matches existing Torny users by email or phone, links them into the club, and invites the rest by email.

**Scope:** two endpoints (preview + commit) on the CRM API. Frontend does the CSV parsing client-side and hands the server structured JSON.

**Prerequisites:** CRM admin app with a JWT for a user who has `admin` or `owner` role on `club_members` for the target club.

**Status:** P0 endpoints live in production. Milestone B (`POST /invites/{token}/accept`) is **not built yet** — invite emails go out but the acceptance link will 404 until that lands. Ship the UI but hold the announcement to the club until the acceptance flow ships.

---

## Base URL — the CRM API, not the main one

These endpoints live on **`TornyCrmStack`**, which has its own API Gateway:

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Same auth (Bearer JWT, existing authorizer). Just a different base URL than the main app endpoints. Store both base URLs in your API client config keyed by feature area.

---

## The two endpoints

```
POST /clubs/{club_id}/members/import/preview   (🔒 auth — admin+ on this club)
POST /clubs/{club_id}/members/import/commit    (🔒 auth — admin+ on this club)
```

**Auth model:** the caller must have an active `club_members` row on `{club_id}` with `role IN ('admin','owner')`. Any lower role (`committee`, `player`) returns `403`.

**Rate limits:**
- Preview — no limit (cheap dry-run).
- Commit — recommend not more than 5/hour per club client-side. Server does not enforce this yet.

---

## 1. Preview — `POST /clubs/{club_id}/members/import/preview`

Dry-run. Server matches every row against existing users, assigns a `resolution`, and stashes the authoritative plan in a `member_imports` row that expires **1 hour** after creation. Frontend renders the summary + row-by-row table on the preview screen.

### Request body

```jsonc
{
  "rows": [
    {
      "rowNumber": 2,                 // 1-indexed line number from the CSV, skipping the header
      "email": "aroha@example.com",
      "phone": "+64211234567",        // E.164-ish; server normalizes
      "firstName": "Aroha",
      "lastName": "Ngata",
      "dob": "1992-03-14",            // optional; YYYY-MM-DD
      "membershipType": "Playing member"
    }
    // …up to 1000 rows per call; frontend should chunk at 500 for UX
  ],
  "newUserStrategy": "invite" | "stub",   // default "invite"
  "originalFilename": "members-2026.csv"  // optional, purely for display
}
```

**Rules the server enforces:**
- `rows[]` — 1 ≤ length ≤ 1000. Cap chunks at 500 client-side for a comfortable review UX.
- `newUserStrategy` — decides what happens to rows with no match:
  - `"invite"` — create a `club_invites` row + send email. Requires email.
  - `"stub"` — create a placeholder user row now (no password until they claim). Requires email.
- Every row is normalized: email → lowercase-trimmed, phone → digits + optional leading `+`, DOB → `YYYY-MM-DD`.

### Response — 200

```jsonc
{
  "status": "success",
  "data": {
    "importId": 42,                    // NUMBER (int), not a ULID string. Send back on commit.
    "expiresInMinutes": 60,
    "newUserStrategy": "invite",
    "summary": {
      "totalRows": 84,
      "willSkip": 3,                   // already in this club
      "willLink": 32,                  // matched a user, will add to club
      "willRelink": 1,                 // was in this club, previously revoked — will un-revoke
      "willInvite": 42,                // no match, invite email will fire
      "willStub": 0,                   // no match, stub user will be created (only if newUserStrategy=stub)
      "errors": 6
    },
    "rows": [
      {
        "rowNumber": 2,
        "email": "aroha@example.com",
        "phone": "+64211234567",
        "displayName": "Aroha Ngata",
        "resolution": "linked",         // one of: linked | relinked | skipped | invited | stub_created | error
        "matchedUserId": 812,           // present when resolution matched an existing user
        "matchedVia": "email",          // "email" | "phone" | "none"
        "existingName": "Aroha Ngata",  // from the matched users row
        "existingAvatar": "https://…",
        "phoneMismatch": false,         // matched user's phone differs from the CSV row's phone
        "emailMismatch": false,         // same for email (if matched via phone but email differs)
        "warnings": [                   // non-blocking issues, e.g. invalid_dob
          { "code": "invalid_dob", "message": "\"foo\" is not a valid date" }
        ],
        "error": null
      },
      {
        "rowNumber": 15,
        "email": "not-an-email",
        "displayName": "Sam Harding",
        "resolution": "error",
        "error": { "code": "invalid_email", "message": "\"not-an-email\" is not a valid email address" }
      },
      {
        "rowNumber": 17,
        "email": "shared@x.com",
        "phone": "+64211112222",
        "displayName": "Ambiguous Match",
        "resolution": "error",
        "error": {
          "code": "conflict",
          "message": "Email matches user 500 but phone matches user 812",
          "candidates": [
            { "userId": 500, "matchedVia": "email", "name": "…", "avatarUrl": "…" },
            { "userId": 812, "matchedVia": "phone", "name": "…", "avatarUrl": "…" }
          ]
        }
      }
    ]
  }
}
```

**Card rendering rule per row:**
- `resolution: "linked" | "relinked"` — green, show `existingName` + `existingAvatar` (linked to a real Torny profile). If `phoneMismatch` or `emailMismatch`, show a small drift-warning chip so the owner sees the divergence.
- `resolution: "skipped"` — grey, "Already in the club" chip.
- `resolution: "invited"` — blue, "Will email invite".
- `resolution: "stub_created"` — orange, "Will create placeholder account".
- `resolution: "error"` — red, show `error.message`. For `conflict`, render the two candidates and let the owner pick which one to link (see §4).

### Response — errors

- `400` — `rows[]` missing/empty, over 1000 rows, invalid JSON body
- `401` — no auth
- `403` — caller isn't `admin`+ on this club

---

## 2. Commit — `POST /clubs/{club_id}/members/import/commit`

Applies the preview plan. Idempotent on `importId` — replaying returns the same result.

### Request body

```json
{ "importId": 42 }
```

### Response — 200

```jsonc
{
  "status": "success",
  "data": {
    "importId": 42,
    "committed": true,
    "replayed": false,                // true if this importId was already committed
    "actualCounts": {
      "linked": 32,
      "relinked": 1,
      "invited": 42,
      "stubCreated": 0,
      "skipped": 3,
      "failed": 0                     // rows the server couldn't apply (race, dupe email, etc.)
    },
    "notificationsFired": {
      "pushSent": 32,                 // NOTE: currently in-app notifications, not push (see §7)
      "emailsSent": 42
    },
    "rows": [
      { "rowNumber": 2,  "resolution": "linked" },
      { "rowNumber": 15, "resolution": "error" },
      { "rowNumber": 17, "resolution": "stub_created", "stubUserId": 1234 },
      { "rowNumber": 20, "resolution": "invited", "failed": true, "message": "duplicate email" }
      // …one entry per row from the preview
    ]
  }
}
```

**Idempotency:** commit is safe to retry — the second call returns `replayed: true` and the same `actualCounts`. If a row failed the first time (race with another signup, for example), the retry does **not** attempt it again — you have to run a fresh preview to pick up the changes.

**Partial success is normal.** Non-zero `actualCounts.failed` doesn't turn the whole request into a failure; the successful rows are still committed. Show a toast for the failed ones and offer a "retry with a fresh preview" flow.

### Response — errors

- `400` — missing `importId`, invalid JSON
- `401` — no auth
- `403` — caller isn't `admin`+ on this club
- `404` — `importId` doesn't exist or belongs to another club
- `410` — import expired (past the 1h TTL) or was cancelled — user has to upload again

---

## 3. Per-row error codes (frontend switches on `error.code`)

| Code | Meaning | UX |
|---|---|---|
| `invalid_email` | Email doesn't match a basic pattern | Red row, error text under the email cell |
| `invalid_phone` | Phone couldn't be normalized (< 7 digits, garbage chars) | Same |
| `duplicate_in_csv` | Same email or phone appears earlier in the CSV | "Duplicate of row N" (N is in the message) |
| `missing_required` | No email AND no phone (or, for the stub path, no email) | "Add an email or phone to include this row" |
| `conflict` | Email and phone matched different existing users | Modal with the two candidates — owner picks which to link, or excludes the row |
| `invalid_dob` | (Warning, not blocking) DOB doesn't parse | Warning chip; the row still commits without a DOB |

`conflict` is the only interesting one — the response includes a `candidates` array so you can render both users' name + avatar and let the owner pick. That decision doesn't need a new endpoint — the owner just excludes the row from the commit or edits the CSV and re-previews.

---

## 4. UI flow — the wizard

Match the frontend team's design (§10 of the original brief). Six steps:

1. **Upload CSV** — drag-drop or paste. Parse client-side (PapaParse or similar).
2. **Field mapping** — map CSV columns → Torny fields (`email`, `phone`, `firstName`, `lastName`, `dob`, `membershipType`). Save the last mapping to localStorage as a default for the next import.
3. **Strategy** — radio: "Invite them to sign up" vs "Just add them as placeholder accounts". Default = invite. Explain the trade-off inline.
4. **Preview** — POST to `/preview`. Render the summary + row table. Owner can:
   - Exclude individual rows (drop them from the payload before commit — no new API needed, just don't send that `rowNumber`).
     - **Wait — the commit endpoint takes `importId` only, not row selection.** For MVP: to exclude rows, re-run preview with those rows removed. Roadmap: extend commit to accept an `excludeRowNumbers: []` field.
   - Resolve `conflict` rows by editing the CSV and re-previewing.
5. **Commit** — POST to `/commit` with the `importId`. Show progress spinner; a 500-row commit takes ~5–15s depending on how many emails are firing.
6. **Success** — "84 members added" summary from `actualCounts`. Link back to the members list which should refetch and show the new rows.

---

## 5. Timing + limits

- **1000-row hard cap per preview** (server-enforced).
- **500-row soft cap client-side** for UX (owner reviews too many rows otherwise).
- **1-hour preview TTL.** If the owner walks away between preview and commit, they must re-preview.
- **Commit latency:** roughly 20–50ms per matched user, ~200–500ms per invite email (SendGrid). Budget ~15s for a 100-row invite-heavy commit.
- **Preview is idempotent in the sense that** repeated previews just create more `member_imports` rows (they don't overwrite each other). Only committed imports write to `club_members` / `club_invites` / `users`.

---

## 6. Deviations from the original design brief

The frontend brief you wrote sketched a few things differently. Reality:

1. **`importId` is a number, not a `imp_01H...` ULID string.** TS type: `number`. If we ever need external-facing opaque IDs we can add a `public_id` column later — not needed for MVP.
2. **Push notifications aren't wired.** For `linked`/`relinked` rows the server writes an in-app `notifications` row via the existing helper (the mobile app polls that feed) and optionally fires an SES email if `SES_ENABLED=true`. `notificationsFired.pushSent` is the count of in-app notifications created — not APNS/FCM pushes. If the design pattern is important for the mobile UX, flag it and we'll add Expo push in a follow-up.
3. **Stub-user path requires an email.** The original brief allowed stub creation with just a phone. `users.email` is `UNIQUE NOT NULL` in the DB, so phone-only rows return `error: missing_required` on preview. Not worth changing for MVP.
4. **`POST /invites/{token}/accept` doesn't exist yet.** Invite emails go out with a link, but hitting that link will 404. Ship the CSV flow with `newUserStrategy: "stub"` for now; wait on the acceptance endpoint before letting owners send real invite emails. Milestone B on our side.
5. **Excluding rows from commit isn't wired.** Commit takes `importId` only. For MVP: to skip rows, filter them out client-side and re-preview. Roadmap: add `excludeRowNumbers: number[]` to the commit body.
6. **No `DELETE /import/{id}` (cancel) or `GET /imports` (history).** P1/P2 in the plan — skip for now.

---

## 7. Notifications — what actually fires

- **Linked/relinked rows** → `notifications` DB row (`notification_type: 'club_membership_added'`, `title`, `message`, `link: /clubs/{club_id}`) + email via SES if the user has `email_notifications_enabled = 1` and the environment has `SES_ENABLED=true`. Mobile app picks up the notification on next `GET /notifications` poll.
- **Invited rows** → SendGrid email. Subject: `{inviter name} added you to {club name} on Torny`. Body includes a link `{APP_BASE_URL}/invites/{accept_token}` — which currently 404s (see §6.4). Email will still send.
- **Stub-created rows** → no notification. Deliberately — brief §5 says the club handles this separately.
- **Skipped / errored rows** → nothing.

If SendGrid isn't configured (no `SENDGRID_API_KEY` in the Lambda env — currently it is) the invite email is silently skipped and `emailsSent` reflects the count that actually went out.

---

## 8. Testing checklist

- Owner uploads a 3-row CSV where row 1 is an existing user (linked), row 2 is a new email (invited), row 3 has no email or phone (`missing_required`). Preview returns matching counts + shape. Commit lands: 1 club_members row, 1 club_invites row, 1 error row untouched.
- Preview + walk away for 90 min → commit returns 410 with "Import has expired" message.
- Two owners preview the same CSV simultaneously → both get their own `importId`. Committing both re-imports the same rows: the second `linked` row for a user gets `skipped` on the second commit because the first one already added them.
- Preview a CSV where the email matches user A but the phone matches user B → row shows `resolution: "error"` with `error.code: "conflict"` and both candidates.
- Preview a CSV row whose email matches a Torny user who's been revoked from this club before → `resolution: "relinked"`. Commit un-revokes the old `club_members` row (preserves `joined_at`).
- Committee-role user tries to hit preview → 403.
- Post-commit, hit `/clubs/{club_id}/memberships` — new members show up. Existing endpoint, unchanged shape.

---

## 9. Response shape cheat-sheet (for typing)

```ts
type Resolution = 'linked' | 'relinked' | 'skipped' | 'invited' | 'stub_created' | 'error';

type ErrorCode =
  | 'invalid_email' | 'invalid_phone' | 'duplicate_in_csv'
  | 'missing_required' | 'conflict' | 'invalid_dob';

interface PreviewRow {
  rowNumber: number;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  resolution: Resolution;
  matchedUserId: number | null;
  matchedVia: 'email' | 'phone' | 'none';
  existingName: string | null;
  existingAvatar: string | null;
  phoneMismatch: boolean;
  emailMismatch: boolean;
  warnings?: { code: string; message: string }[];
  error: {
    code: ErrorCode;
    message: string;
    candidates?: { userId: number; matchedVia: string; name: string; avatarUrl: string | null }[];
  } | null;
}

interface PreviewResponse {
  status: 'success';
  data: {
    importId: number;
    expiresInMinutes: number;
    newUserStrategy: 'invite' | 'stub';
    summary: {
      totalRows: number; willSkip: number; willLink: number;
      willRelink: number; willInvite: number; willStub: number; errors: number;
    };
    rows: PreviewRow[];
  };
}

interface CommitResponse {
  status: 'success';
  data: {
    importId: number;
    committed: boolean;
    replayed: boolean;
    actualCounts: {
      linked: number; relinked: number; invited: number;
      stubCreated: number; skipped: number; failed: number;
    };
    notificationsFired: { pushSent: number; emailsSent: number };
    rows: { rowNumber: number; resolution: Resolution; stubUserId?: number; failed?: boolean; message?: string }[];
  };
}
```

---

## 10. Contact

Backend owner: Nev — same as previous briefs. Ping in Slack if a shape decision is contentious before you build against it — cheaper to change now than after the migration ships.

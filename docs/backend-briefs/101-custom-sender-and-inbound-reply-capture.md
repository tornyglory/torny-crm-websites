# Brief 101 — Custom sender email + centralised reply capture

**Scope:**
- API (`general` repo): SES identity management per club (verify / status / remove), inbound-mail receiving pipeline (`replies.torny.co` MX + SES Receipt Rules + Lambda), bounce / complaint handlers, new `member_communications` rows for every reply, two new tables (`club_email_domains`, `communication_threads`).
- CRM FE (`apps/crm`): wire the Settings → Integrations → AWS SES card. Reuses the DNS instructions table component we just shipped for brief 99 — no new editor UI yet (brief 102 handles the composer).

**Prereq:** none. Replaces the fixed `noreply@torny.com` sender with per-club sender identities. Compatible with the existing `member_communications` schema — adds columns for threading rather than replacing the model.

---

## 1. The ask

Three things the current platform can't do:

1. **Send mail that reads as from the club.** Today every outbound hits inbox as `noreply@torny.com`. Clubs want `secretary@naenaebowls.nz` in the From line — same domain as their public site, no Torny branding on the sender.
2. **Keep replies.** When a member hits Reply on a campaign, that reply vanishes into the admin's personal inbox (if we're lucky) or bounces (if the Reply-To was a Torny-owned address). Neither ends up in the CRM.
3. **Capture bounces and complaints by member.** We already handle these for outbound delivery tracking, but we don't yet surface them as roster-level signals ("this member's email is dead; stop trying").

All three need the same plumbing — SES identity ownership per club + an inbound-receiving pipeline — so they ship together.

---

## 2. Why

- **Deliverability.** Mail from a Torny-owned sender to 200 member addresses gets grey-listed hard. Mail from `secretary@naenaebowls.nz` signed with the club's own DKIM keys lands in Primary tabs.
- **Brand continuity.** The club website is at `naenaebowls.nz`, the sender should be too. "From" matching the website domain is the single biggest signal to a recipient that the email is legitimate.
- **Centralised CRM.** The whole point of Torny is one place for every member conversation. Replies going to the admin's Gmail and never making it back to the member's row defeats the model.
- **Member-level deliverability state.** `bounced` and `complained` already exist on `member_communications` for the delivery status of a specific send — but the roster has no column answering "has anyone ever bounced from this address?" That answer drives the `lapsed_email` suggestion in the member list.

---

## 3. Architecture

### 3.1 Outbound

Each club gets a verified SES domain identity on Torny's AWS account:

```
Club admin enters            naenaebowls.nz
   │
   ▼
Torny calls SES              VerifyDomainIdentity(naenaebowls.nz)
                             VerifyDomainDkim(naenaebowls.nz)
                             SES returns 3 DKIM tokens + MAIL FROM target
   │
   ▼
Admin adds DNS records       3 × CNAME (DKIM)
at their registrar           1 × MX    (optional MAIL FROM subdomain)
                             1 × TXT   (SPF on MAIL FROM subdomain)
   │
   ▼
Torny polls SES              GetIdentityVerificationAttributes
                             → Pending → Success
   │
   ▼
Outbound mail                From:          Naenae Bowling Club <secretary@naenaebowls.nz>
                             Reply-To:      thread+<token>@replies.torny.co
                             Return-Path:   bounces@bounces.naenaebowls.nz (or bounces.torny.co fallback)
                             DKIM-Signature by naenaebowls.nz keys
                             List-Unsubscribe: <existing unsubscribe link>
```

### 3.2 Inbound

One zone, one MX, serves every club:

```
Member hits Reply                thread+abc123@replies.torny.co
   │
   ▼
replies.torny.co MX              → inbound-smtp.ap-southeast-2.amazonaws.com
   │
   ▼
SES Receipt Rule                 → publishes to SNS topic `torny-inbound-mail-prod`
                                 → (also writes raw MIME to S3 bucket for 30 days)
   │
   ▼
Lambda `inbound-mail-handler`    1. Parse token from local-part
                                 2. Look up thread row → (club_id, user_id, source communication_id)
                                 3. Parse MIME → extract text/plain + text/html bodies
                                 4. Download + rehost inline images / attachments to S3
                                 5. Insert new member_communications row: channel='email',
                                    direction='inbound', in_reply_to_communication_id=<source>
                                 6. Fire-and-forget SNS → in-app notifications for club admins
                                    watching this thread
```

### 3.3 Bounces + complaints

SES already publishes these to SNS for every outbound. Today we consume them to update the outbound row's status. Extend the same handler:

- On `bounce` with `bounceType='Permanent'` → set `users.email_status = 'bounced'` + `email_bounced_at = NOW()`. Roster query that drives `computed_status` folds this into `lapsed_email`.
- On `complaint` → set `users.email_status = 'complained'`, auto-unsubscribe the user from bulk mail (write the usual unsubscribe row), surface a toast to the admin on their next CRM page view.

No schema change on the outbound side — just new logic on top of existing SNS hooks.

---

## 4. Data model

### 4.1 `club_email_domains` — new

| Column | Type | Note |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY` | |
| `club_id` | `BIGINT NOT NULL` | FK → `clubs`. |
| `domain` | `VARCHAR(253) NOT NULL` | e.g. `naenaebowls.nz`. Lowercased. |
| `ses_identity_arn` | `VARCHAR(255) NULL` | Returned by SES on verify. |
| `verification_status` | `ENUM('pending','verified','failed','removed') NOT NULL` | Mirrors SES. |
| `dkim_tokens` | `JSON NOT NULL` | Three tokens so the FE can render / re-verify the required records. |
| `mail_from_domain` | `VARCHAR(253) NULL` | e.g. `bounces.naenaebowls.nz`. Null = use `bounces.torny.co`. |
| `default_from_name` | `VARCHAR(100) NULL` | Shown as display name. Defaults to club name. |
| `default_from_local` | `VARCHAR(64) NOT NULL DEFAULT 'noreply'` | Local part; full address = `{local}@{domain}`. |
| `default_reply_to` | `VARCHAR(255) NULL` | Optional human address replies should ALSO forward to (e.g. `secretary@naenaebowls.nz`). |
| `created_at` / `updated_at` | `TIMESTAMP` | |

Index on (`club_id`), unique on (`domain`) so no two clubs claim the same sender.

### 4.2 `communication_threads` — new

| Column | Type | Note |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY` | |
| `club_id` | `BIGINT NOT NULL` | |
| `user_id` | `BIGINT NOT NULL` | The member this thread is with. |
| `token` | `VARCHAR(32) NOT NULL` | Random base32 — the piece that goes into Reply-To. |
| `subject` | `VARCHAR(255) NULL` | First send's subject; replies inherit. |
| `source_communication_id` | `BIGINT NOT NULL` | FK → `member_communications` — the original outbound row. |
| `reply_count` | `INT NOT NULL DEFAULT 0` | For sort / badge. |
| `last_reply_at` | `TIMESTAMP NULL` | Latest inbound. Null until first reply lands. |
| `created_at` | `TIMESTAMP NOT NULL` | |

Unique index on (`token`). Index on (`club_id`, `user_id`, `last_reply_at`) for the Communications tab.

### 4.3 `member_communications` — additive columns

| Column | Type | Note |
|---|---|---|
| `direction` | `ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound'` | Inbound rows carry the full reply body; outbound rows unchanged. |
| `thread_id` | `BIGINT NULL` | FK → `communication_threads`. Null on pre-threading rows + notes. |
| `in_reply_to_communication_id` | `BIGINT NULL` | FK → self. Links a reply to the specific row it replied to. |
| `raw_s3_key` | `VARCHAR(255) NULL` | Inbound only — points at the full MIME in S3 for 30 days. Null thereafter. |

Index on `thread_id` for the per-thread listing.

### 4.4 `users` — additive columns

| Column | Type | Note |
|---|---|---|
| `email_status` | `ENUM('active','bounced','complained','unsubscribed') NOT NULL DEFAULT 'active'` | Roster-level deliverability. Flipped by SES SNS handler. |
| `email_bounced_at` | `TIMESTAMP NULL` | First permanent bounce. |
| `email_complained_at` | `TIMESTAMP NULL` | First spam complaint. |

Nothing on this touches the existing `member_communications.status` column — that stays per-message.

---

## 5. Endpoint spec

### 5.1 `POST /clubs/{club_id}/email-domain`

**Auth:** owner-only.

```json
{ "domain": "naenaebowls.nz", "default_from_local": "noreply" }
```

Steps:

1. Validate domain (brief 99's shape check applies — no `torny.club`, no `pages.dev`).
2. Reject if another club owns the same domain (`409 domain_taken`).
3. Call SES `VerifyDomainIdentity` + `VerifyDomainDkim`.
4. Insert `club_email_domains` row with `verification_status='pending'`, store the three DKIM tokens.
5. Return the row + required DNS records.

```json
201 {
    "status": "success",
    "data": {
        "id": 7,
        "domain": "naenaebowls.nz",
        "verification_status": "pending",
        "default_from_local": "noreply",
        "required_records": [
            { "type": "CNAME", "host": "<tok1>._domainkey.naenaebowls.nz", "value": "<tok1>.dkim.amazonses.com" },
            { "type": "CNAME", "host": "<tok2>._domainkey.naenaebowls.nz", "value": "<tok2>.dkim.amazonses.com" },
            { "type": "CNAME", "host": "<tok3>._domainkey.naenaebowls.nz", "value": "<tok3>.dkim.amazonses.com" },
            { "type": "MX",    "host": "bounces.naenaebowls.nz", "value": "10 feedback-smtp.ap-southeast-2.amazonses.com", "optional": true },
            { "type": "TXT",   "host": "bounces.naenaebowls.nz", "value": "v=spf1 include:amazonses.com ~all", "optional": true }
        ]
    }
}
```

### 5.2 `GET /clubs/{club_id}/email-domain`

Returns the current row or `404 not_found`. Same shape as §5.1's `data`.

### 5.3 `POST /clubs/{club_id}/email-domain/verify`

Re-polls SES and updates `verification_status`. Called when the FE's "Check DNS" button is clicked. Same shape as §5.2.

### 5.4 `PATCH /clubs/{club_id}/email-domain`

Updates the mutable fields: `default_from_local`, `default_from_name`, `default_reply_to`. Doesn't touch the domain or DKIM state. Returns the updated row.

### 5.5 `DELETE /clubs/{club_id}/email-domain`

Owner-only. Calls SES `DeleteIdentity`, nulls out the row (keeps for audit with `verification_status='removed'`). Outbound reverts to `noreply@torny.com` for this club.

### 5.6 Inbound Lambda — not an API endpoint

Triggered by `torny-inbound-mail-prod` SNS topic. Not externally callable. Spec'd here so the brief is complete:

1. Parse token from the `To` header (`thread+<token>@replies.torny.co`).
2. Look up `communication_threads` by token → `(club_id, user_id, source_communication_id)`.
3. Pull raw MIME from S3 (SES Receipt Rule already wrote it).
4. Parse MIME → `text/plain`, `text/html` (prefer plain), attachments.
5. For inline images: copy to the existing media bucket, rewrite `cid:` references.
6. Insert `member_communications` row with `direction='inbound'`, `channel='email'`, `thread_id`, `in_reply_to_communication_id`, `body=<text>`, `provider_message_id=<message-id header>`.
7. Bump `communication_threads.reply_count`, set `last_reply_at`.
8. If `club_email_domains.default_reply_to` is set, forward the parsed email there too (fire-and-forget via SES SendEmail).
9. Publish SNS notification → in-app badge for anyone subscribed to this thread.

Token unknown or malformed → drop silently (don't bounce — avoids a signal-amplification vector).

### 5.7 Bounce / complaint SNS handler — extends existing

Already handles `member_communications.status` updates per brief 68. Extend:

- Permanent bounce → `users.email_status='bounced'`, `email_bounced_at=NOW()`.
- Complaint → `users.email_status='complained'`, `email_complained_at=NOW()`, auto-unsubscribe via existing path.
- Both fire-and-forget an in-app notification.

### 5.8 Error codes

| Code | HTTP | When |
|---|---|---|
| `domain_required` | 400 | Payload missing. |
| `domain_invalid` | 422 | Fails format check. |
| `domain_reserved` | 422 | On a Torny-owned zone. |
| `domain_taken` | 409 | Another club has it. |
| `ses_verification_failed` | 502 | SES VerifyDomainIdentity errored. |
| `forbidden` | 403 | Non-owner on mutations. |
| `not_found` | 404 | No row for this club. |

---

## 6. Outbound send-path changes

Current `sendBulkEmail` / per-template sender resolution: hardcoded `noreply@torny.com` (SAM base). Changes:

1. Before dispatching a batch, look up `club_email_domains` for the club.
2. If `verification_status='verified'`: build `From` as `"{default_from_name}" <{default_from_local}@{domain}>`, set the SES `FromArn` to the verified identity, mint a `communication_threads` row per outbound message, use `Reply-To: thread+{token}@replies.torny.co`.
3. If no verified domain: fall back to `noreply@torny.com` + `Reply-To: thread+{token}@replies.torny.co` (so reply capture still works even on the fallback sender).

Either way, every outbound has a thread + token so inbound can land. The sender's domain is the only piece that changes.

---

## 7. CRM FE — the Settings → Integrations → AWS SES card

Reuses the DNS instructions table from brief 99 verbatim — Host / Type / Required data / Current data with Cloudflare DoH verification. Behavioural differences:

- The records are **TXT + CNAME + MX** (not just CNAME). The table's `Type` column already handles arbitrary strings.
- Status beside each record: `ok` when the CNAME is present AND SES's `verification_status === 'verified'`; otherwise `pending`.
- `Check DNS` button calls `POST /clubs/:id/email-domain/verify` and re-polls SES in addition to the client-side DoH lookup (SES is the source of truth for "verified", DoH is for "the record is published").

New fields under the records table:

- **From name** (text) — prefilled with club name. Example preview: `Naenae Bowling Club <noreply@naenaebowls.nz>`.
- **From local part** (text) — prefilled `noreply`. Live preview updates.
- **Also forward replies to** (email, optional) — when set, inbound Lambda also forwards to this address so admins who want a native-inbox copy can have one.

No composer UI in this brief — admins still send via the existing Campaigns flow. They just see replies land in the Communications tab on each member.

---

## 8. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # owner JWT
CLUB=5

# 1. Add a sender domain
curl -s -X POST "$VENUE/clubs/$CLUB/email-domain" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"domain":"naenaebowls.nz","default_from_local":"noreply"}' | jq
# → 201 { verification_status: "pending", required_records: [...] }

# 2. Get status
curl -s "$VENUE/clubs/$CLUB/email-domain" -H "Authorization: Bearer $TOKEN" | jq '.data.verification_status'
# → "pending"

# 3. Admin adds DKIM CNAMEs. Verify via SES poll.
curl -s -X POST "$VENUE/clubs/$CLUB/email-domain/verify" -H "Authorization: Bearer $TOKEN" | jq '.data.verification_status'
# → "verified"   (once SES reports Success — usually <30 min)

# 4. Send a test campaign via existing bulk-email path.
#    The outbound has:
#      From: Naenae Bowling Club <noreply@naenaebowls.nz>
#      Reply-To: thread+<token>@replies.torny.co

# 5. Member hits Reply → within 30 sec of SES inbound:
curl -s "$VENUE/clubs/$CLUB/members/9981/communications" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.communications[] | select(.direction=="inbound") | {subject, in_reply_to_communication_id, body}'
# → { subject: "Re: AGM Notice", in_reply_to_communication_id: 442, body: "…" }

# 6. Member on a defunct address → send bounces → users table flips.
curl -s "$VENUE/clubs/$CLUB/members/9981" -H "Authorization: Bearer $TOKEN" | jq '.data.email_status'
# → "bounced"   (and that member now shows `lapsed_email` in the roster)

# 7. Remove the sender identity
curl -s -X DELETE "$VENUE/clubs/$CLUB/email-domain" -H "Authorization: Bearer $TOKEN"
# → 200
# → Next outbound reverts to noreply@torny.com but Reply-To tokens still work
```

---

## 9. Pass criteria

- ✓ Verified club domain sends mail with `From: {name} <{local}@{domain}>`, DKIM-signed by the club domain.
- ✓ Every outbound carries `Reply-To: thread+<token>@replies.torny.co` regardless of verified-domain state.
- ✓ Inbound to `replies.torny.co` lands a new `member_communications` row within 30 sec of receipt, linked to the thread + source message.
- ✓ Permanent bounces flip `users.email_status` and roster surfaces `lapsed_email`.
- ✓ Complaints auto-unsubscribe + flag.
- ✓ Unknown tokens on inbound → silent drop. No bounce-amplification.
- ✓ Non-owner / non-member can't mutate the identity.
- ✓ CRM FE Settings → Integrations → AWS SES shows the DNS table + the live SES verification state.

---

## 10. Non-goals

- **BYO SES / SMTP.** A future brief could let a club connect their *own* AWS account / Postmark / Mailgun. Out of scope here — Torny-owned SES serves every club.
- **Full IMAP-style inbox UI.** The Communications tab is per-member, not a unified inbox. Separate brief if we want cross-member inbox triage.
- **Attachment virus scanning.** We rehost inbound attachments but don't scan them. Add if real-world abuse shows up.
- **Reply composer.** Brief 102. Admins still reply via Gmail-and-have-it-captured OR wait for the composer.
- **Deliverability dashboard.** The campaign-level metrics we have cover it; a dedicated deliverability page is a separate brief.
- **DMARC advice / templating.** We land on relaxed alignment through SPF; strict DMARC adopters can set their own policy higher. We don't try to teach DMARC inside Torny.
- **Multi-domain sending.** One domain per club. If a club rebrands, DELETE + re-add.

---

## 11. Rollout notes

- SES account sandbox removal needs to be done *before* the first production club connects. One-time AWS support ticket. Request the increase alongside provisioning the `replies.torny.co` zone + MX.
- Existing `noreply@torny.com` sender keeps working for unconfigured clubs — no forced migration.
- The three DKIM CNAMEs + optional MAIL FROM MX + SPF TXT are what the admin pastes into their registrar. Same UX pattern as brief 99's custom-domain flow; we lean on the component already built.
- Thread tokens are 128-bit random (base32-encoded, 26 chars). Guessing one buys an attacker the ability to inject a reply into some random member's thread — low blast radius, and we can rate-limit the inbound Lambda per token to kill script-kiddie probes.

---

## 12. Contact

Nev on Slack (`#torny-eng`). Backend: two new tables, five endpoints, one Lambda, extend one existing SNS handler. CRM FE: Settings → Integrations card wired to the existing DNS table component. Zero new editor UI — that's brief 102.

Suggested ship order: §4 schema + §5.1-5.2 (add + get), then §5.6 inbound Lambda (so replies land even if the admin hasn't verified yet via Torny fallback), then §5.7 bounce/complaint extensions, then the FE card. Each step ships standalone.

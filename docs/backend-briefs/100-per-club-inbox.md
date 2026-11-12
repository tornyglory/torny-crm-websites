# Brief 100 — Per-club inbox: send + receive via SES

> **Backend status (2026-11-12):** Steps 1–8 of §9 are shipped. The only
> two remaining backend touchpoints are (a) the Cloudflare MX record flip
> and the 3 extra DKIM CNAMEs for us-west-2 SES (user-side, instructions
> at the end of this doc), and (b) the FE work in §5 which this brief
> covers.

**Scope:**
- Each club picks a handle. Their email address is `<handle>@torny.pro`.
- Outbound: CRM sends emails from that address. Recipients see a branded, per-club From.
- Inbound: Replies to that address land in SES → S3 → Lambda → our API, which parses, matches to a member, stores as a `member_communications` row, fires a notification.
- FE: new card on Settings → Integrations to pick/edit the handle. Communications timeline on each member's page already shows `member_communications` rows — inbound emails use the same row type and render alongside notes + outbound sends.

**Prereq:** `torny.pro` is a verified SES domain identity in `ap-southeast-2` (done). Sending works today from `noreply@torny.pro`.

**Vendor choice:** AWS SES (both directions). Cloudflare Email Routing was considered and dropped in favour of single-vendor ops + shared reputation / feedback loop between inbound and outbound. SES Inbound only exists in `us-east-1 / us-west-2 / eu-west-1`; we'll use `us-west-2` (closest to the Sydney API).

---

## 11. FE status — shipped

Landed on `main`:

- `packages/api-client/src/resources/clubs.ts` — new `checkEmailHandle(value)` + `changeEmailHandle(clubId, value)` bindings. Typed `ChangeEmailHandleErrorCode` covers every §10.2 error code. Routed through `VENUE_BASE` to match the CFN-cap split.
- `packages/api-client/src/resources/communications.ts` — `CommunicationChannel` gains `'email_inbound'`; `MemberCommunication` gains the §10.3 inbound-only columns (`from_name`, `from_email`, `received_at`, `message_id`, `in_reply_to`, `parent_communication_id`, `body_html`, `raw_s3_key`).
- `packages/api-client/src/types.ts` — `Club.emailHandle` added; the CRM `club` store carries it through `hydrateFull`.
- `apps/crm/src/views/settings/ClubInboxCard.vue` — new component slotted into Settings → Integrations above the generic card grid. Mirrors the brief 98 subdomain editor: inline Edit button (owner-only), 300ms-debounced availability check with aborts, inline status copy for each §10.1 reason code, confirm modal before commit, idempotent save, `clubStore.setCurrent({ ...current, emailHandle })` on success so other surfaces see the new value without a refresh.
- `apps/crm/src/views/members/MemberDetailView.vue` — Communications tab's `emailsFeed` now covers both `'email'` and `'email_inbound'`. Inbound rows get their own row variant (blue inbound chip, sender name + `<email>`, received timestamp, a `Reply` outline button). The Reply button opens the existing `SendEmailModal` with a new `prefill-subject` prop set to `Re: <original>` (idempotent — `Re: Re: …` is suppressed). Row grammar matches the Paper design; the per-row interaction is distinct from outbound (which opens the EmailDetailModal on click).
- `apps/crm/src/components/modals/SendEmailModal.vue` — new optional `prefillSubject` prop; populated into `state.subject` on each open.

Pass criteria met from §10.5:
- ✓ Owner can pick + change a handle; non-owners can't (gated on `usePermissions().isOwner`).
- ✓ Debounced availability check with four reason codes rendered.
- ✓ Communications timeline renders inbound emails with sender, timestamp, subject. Unlinked inbound surfacing (brief §10.5 bullet 3) is deferred until we have a concrete signal to design around — flagged as a follow-up.

What's still needed from the backend before this flows end-to-end:
- Cloudflare MX flip + 3 extra DKIM CNAMEs on `torny.pro` (user-side, §11 of the original brief).
- The activate-receipt-rule-set command post-InboxStack deploy.
- Optional: an inbound-Reply endpoint upgrade that accepts `in_reply_to_message_id` so Gmail / Outlook thread the outbound reply with the original. The FE currently skips the header; the reply still goes out through the normal bulk-email path and lands fine, just without client-side threading.

## 1. Architecture

```
      ┌───────────────────────────────────┐
      │  Outbound (ap-southeast-2)        │
      │                                   │
      │   send-club-email.js              │
      │   From: <handle>@torny.pro        │
      │   Reply-To: <handle>@torny.pro    │
      │         │                         │
      │         ▼                         │
      │   SES (ap-southeast-2)            │
      │   torny.pro domain identity       │
      └───────────────────────────────────┘

      ┌───────────────────────────────────┐
      │  Inbound (us-west-2)              │
      │                                   │
      │   Mail → MX → SES receipt rule    │
      │     (torny.pro catch-all)         │
      │         │                         │
      │         ▼                         │
      │   S3 bucket                       │
      │   `torny-inbox-<env>` /           │
      │   `raw/<message-id>.eml`          │
      │         │                         │
      │         ▼ S3 ObjectCreated event  │
      │                                   │
      │   torny-inbox-processor Lambda    │
      │     - reads raw MIME from S3      │
      │     - parses: From, To, Subject,  │
      │       Body (text+html), Message-  │
      │       ID, In-Reply-To, References │
      │     - HMAC-signed POST to API     │
      │         │                         │
      │         ▼                         │
      │   POST /internal/inbound-email    │
      │   (crm-router dispatch, Venue API │
      │    for CFN-cap headroom)          │
      │     - parse recipient → clubId    │
      │     - match sender → userId       │
      │     - insert member_communications│
      │       (type='email_inbound')      │
      │     - notify club admins          │
      └───────────────────────────────────┘
```

---

## 10. FE scope (what to actually build)

Backend is live, three hooks for the FE:

### 10.1 `GET /email-handles/check?value=<handle>` — public availability check

Shape matches `/subdomains/check`:

```json
200 { "status": "success", "data": { "available": true,  "value": "naenaebowls" } }
200 { "status": "success", "data": { "available": false, "reason": "taken", "value": "naenaebowls" } }
200 { "status": "success", "data": { "available": false, "reason": "reserved" } }
200 { "status": "success", "data": { "available": false, "reason": "invalid" } }
```

Reserved reasons cover RFC 2142 role addresses, system senders (`noreply`, `mailer-daemon`), generic roles (`admin`, `support`, `info`), Torny brand + subdomain-reserved items.

### 10.2 `PATCH /clubs/{club_id}/email-handle` — owner-only save

```
PATCH .../clubs/42/email-handle
{ "email_handle": "naenaebowls" }

200 {
    "status": "success",
    "data": {
        "club_id": 42,
        "email_handle": "naenaebowls",
        "address": "naenaebowls@torny.pro"
    }
}
```

Error codes: `email_handle_required` (400), `email_handle_invalid` (422), `email_handle_reserved` (422), `email_handle_taken` (409), `forbidden` (403), `not_found` (404). Idempotent on re-save of the same value.

### 10.3 Communications tab — render `channel = 'email_inbound'` rows

Row shape adds: `from_name`, `from_email`, `received_at`, `message_id`, `in_reply_to`, `parent_communication_id`, `body_html`, `raw_s3_key` (forensics only; FE never reads this directly).

Render: inbound chip, sender identity, received timestamp, subject, Reply button → opens existing composer prefilled with `To: from_email` + `Subject: Re: <subject>`.

### 10.4 Settings → Integrations card (per brief §5.1)

`ClubInboxCard.vue`. Reads handle from `GET /clubs/{id}`, renders `<handle>@torny.pro` live, Edit → inline editor with debounced availability check against §10.1, Save → PATCH per §10.2, confirm modal, toast on success. Non-owner: Edit hidden.

### 10.5 Pass criteria

- ✓ Owner can pick + change a handle; non-owners can't.
- ✓ Debounced availability check with the 4 reason codes rendered clearly.
- ✓ Communications timeline renders inbound emails with sender, timestamp,
  subject, body. Unlinked inbound (`user_id = NULL`) surfacing TBD —
  flagged as a follow-up once a concrete admin flow is agreed.

---

## 11. User-side ops (Nev)

- Add 3 DKIM CNAMEs for us-west-2 SES to `torny.pro` DNS:
  - `kx3orbpiegbnogb44kca46s56ktqhxnc._domainkey` CNAME `kx3orbpiegbnogb44kca46s56ktqhxnc.dkim.amazonses.com`
  - `3fiiz6syxtq323yi5khhuyw6eotyop7t._domainkey` CNAME `3fiiz6syxtq323yi5khhuyw6eotyop7t.dkim.amazonses.com`
  - `nczmq5lop4sgvfkbhpbh43p6nhugynk7._domainkey` CNAME `nczmq5lop4sgvfkbhpbh43p6nhugynk7.dkim.amazonses.com`
  (All DNS only / grey cloud)
- Add MX record:
  - `torny.pro` MX `10 inbound-smtp.us-west-2.amazonaws.com` (DNS only)
- After the InboxStack deploys, activate the receipt rule set:
  - `aws ses set-active-receipt-rule-set --rule-set-name torny-inbound --region us-west-2`

---

## 12. Contact

Nev on Slack (`#torny-eng`). Backend shipped, FE now shipped too — the only thing between us and end-to-end mail flow is the DNS changes above.

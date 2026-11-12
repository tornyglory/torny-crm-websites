# Brief 104 — Member-communication notifications: deep-link straight into the thread

**Scope:**
- API (this repo): one field change on the `member_communication_inbound` notification payload — set `destination_href` to the exact thread URL instead of the member detail root.
- CRM FE (`tornyglory/torny-crm-websites`, `apps/crm`): nothing. The FE deep-link routing is already shipped (commit `4021817` on `main`).

**Prereq:** brief 100 shipped (`member_communication_inbound` notifications are being emitted when inbound email lands) + brief 101 shipped (thread view in the CRM).

---

## 1. The ask

Today's `member_communication_inbound` notification carries `destination_href = /crm/members/{user_id}`. Click → member detail page, default (Payments) tab, admin has to switch to Communications, scroll the inbox, find the email, click it. Four clicks of friction to read a reply we specifically pinged them about.

Change the field to point at the thread directly:

```
destination_href = `/crm/members/${user_id}/communications/${comm_id}`
```

Where `comm_id` is the `member_communications.communication_id` of the inbound row that triggered the notification (the same id we're already storing when we `fanoutCrmNotification({ clubId, type: 'member_communication_inbound', memberId })`).

That's the only change. Zero schema. Zero new endpoints. One string template per fanout.

---

## 2. Why

- **One click, not four.** The FE now understands `/crm/members/:id/:tab?/:commId?` — landing on that URL mounts MemberDetailView on the Communications tab with the brief-101 ThreadView already fetched + rendered. The admin reads the reply, hits Reply, done.
- **Routing scaffolding is already shipped.** `apps/crm/src/router/index.ts:61` exposes the optional `:tab?/:commId?` segments; `MemberDetailView` reads them. Any href we send gets honoured.
- **Works today even for pre-existing notifications.** If an unclicked notification from yesterday has the old `destination_href`, it still routes to the member page (just not deep-linked). The field change is additive.

---

## 3. Where to make the change

Grep for `member_communication_inbound` in the notification fanout. It's almost certainly a single call site:

```js
await fanoutCrmNotification({
    clubId,
    type: 'member_communication_inbound',
    memberId: userId,
    // …
})
```

The helper is the one that constructs the row (subject, body summary, href). Change the `href` / `destination_href` build to include the `comm_id`. If you've got a URL-builder helper, extend it; if it's inlined, template literal is fine:

```js
destination_href: `/crm/members/${userId}/communications/${communicationId}`
```

---

## 4. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"  # any CRM JWT
CLUB=5

# 1. Send a test email from a known member's address to the club's handle.
#    After 10-20 sec, a member_communication_inbound notification lands.
curl -s "$VENUE/clubs/$CLUB/notifications?limit=1" -H "Authorization: Bearer $TOKEN" \
  | jq '.data.notifications[0] | { type, destination_href, target }'
# → {
#     "type": "member_communication_inbound",
#     "destination_href": "/crm/members/87/communications/442",
#     "target": { ..., "destination_href": "/crm/members/87/communications/442" }
#   }

# 2. Click-through test: open destination_href in the CRM. Should land on
#    the Communications tab with the brief-101 ThreadView mounted for
#    communication_id=442 as the anchor.
```

Existing CRM `destination_href` consumers (the NotificationsDropdown `openRow`, the email-digest links if we've built those) continue to work with the deeper URL since `vue-router` treats the extra segment as route params, not query strings.

---

## 5. Pass criteria

- ✓ Newly fanned-out `member_communication_inbound` notifications carry `destination_href = /crm/members/{user_id}/communications/{communication_id}`.
- ✓ The `target` block exposes the same href if the schema separates `target.destination_href` from the row-level one.
- ✓ Old notifications are left alone (no backfill needed).
- ✓ Other notification kinds (`application_received`, `rsvp_received`, `enquiry_received`, etc.) are untouched — this is scoped to the one `type`.

---

## 6. Non-goals

- **Backfilling historical notifications.** Not worth the write. Clicking an old notification still lands on the member page, the admin finds the thread one tab click away.
- **Deep-linking other channels.** Note/call rows live at `/crm/members/:id/notes` eventually but there's no "notification kind" that points at a specific note today. If we ship one, same pattern (`?note=…` or `:noteId`) — separate brief.
- **Marking the thread as read via the URL.** Read-state isn't tracked yet (brief 101 §9). When it is, the thread-view mount would flip it.
- **Email-digest / off-platform links.** Those render via the existing unsubscribe-safe URL builder. If we emit this href in those surfaces, the same `/crm/members/:id/communications/:commId` URL works — but confirm the auth gate handles an unauthenticated landing.

---

## 7. Contact

Nev on Slack (`#torny-eng`). FE is already consuming whatever `destination_href` you send — you ship the field change, the click starts landing on the thread view immediately.

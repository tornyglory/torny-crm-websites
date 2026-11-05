# Media allowlist — add `venue_package_hero` to accepted entity types

**Feature:** let admins upload the hero image on a venue package. Brief 73 §7 called for this one-line allowlist change but it never landed; the FE is live and hitting the error.

**Status:** acute — the venue-package editor is shipped and the hero uploader (`HeroImageUploader.vue` calling `media.uploadVenuePackageHero()`) fails on every attempt with:

```json
{
  "status": "error",
  "message": "entity_type must be one of: player, club, team, organiser, association, user, tournament"
}
```

No admin can save a hero image on a venue package right now.

**Related briefs:**
- **Brief 60** (page-slug allowlist on media uploads) — original enforcement of the `entity_type` whitelist on `/media/images/upload-url` + `/media/images/confirm`.
- **Brief 73** (venue packages CRM resource) — §7 "Images" said *"Allowlist delta on brief 60: add `venue_package_hero` as a valid kind."* This brief is the delta that §7 referenced.

---

## TL;DR

Add `venue_package_hero` to the accepted values on both `/media/images/upload-url` and `/media/images/confirm`. That's it. No schema changes, no new endpoints.

---

## 1. What the FE sends today

`packages/api-client/src/resources/media.ts → uploadVenuePackageHero()`:

```http
GET /media/images/upload-url
  ?entity_type=venue_package_hero
  &entity_id=42
  &content_type=hero
  &content_id=42
```

And the follow-up confirm:

```http
POST /media/images/confirm
{
  "imageId":      "<Cloudflare image id>",
  "entity_type":  "venue_package_hero",
  "entity_id":    42,
  "content_type": "hero",
  "content_id":   42
}
```

(`42` here is the `venue_packages.id` the admin is editing.)

---

## 2. Backend change

Wherever the `entity_type` whitelist lives (gateway schema, Lambda validator, or stored procedure), add `venue_package_hero` to the accepted set:

```
player, club, team, organiser, association, user, tournament, venue_package_hero
```

Ownership check: the `entity_id` must match a row in `venue_packages` whose `club_id` matches the caller's authorised club. Same pattern as brief 73's PATCH guard — reuse that lookup.

**No schema change needed** — the hero URL is stored on `venue_packages.hero_image_url` via a follow-up `PATCH /clubs/:cid/venue-packages/:id` (brief 73 §4). The media endpoint just needs to let the upload through.

---

## 3. Verification

```bash
# 1. Request upload URL for a package the caller owns — should succeed.
curl -H "Authorization: Bearer $JWT" \
  "$MEDIA/media/images/upload-url?entity_type=venue_package_hero&entity_id=42&content_type=hero&content_id=42"
# → 200 with uploadUrl + imageId

# 2. Confirm the upload.
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$MEDIA/media/images/confirm" \
  -d '{"imageId":"img_abc","entity_type":"venue_package_hero","entity_id":42,"content_type":"hero","content_id":42}'
# → 200 with avatar_url (hero url) + variants

# 3. Someone else's package — must 403.
curl -H "Authorization: Bearer $JWT_OTHER_CLUB" \
  "$MEDIA/media/images/upload-url?entity_type=venue_package_hero&entity_id=42&content_type=hero&content_id=42"
# → 403 { message: "not authorised" }  (venue_package 42 belongs to a different club)
```

Pass criteria:
- ✓ `entity_type=venue_package_hero` no longer 400s with "must be one of…".
- ✓ Cross-club upload attempts still 403.
- ✓ Returned delivery URL renders correctly on the venue-package card + booking wizard hero.

---

## 4. Non-goals

- **No new upload modes.** Only the hero variant for now. Secondary gallery images on venue packages can come later via `content_type: 'gallery'`, same `entity_type` — but we'd need to add that `content_type` to the whitelist in a separate change.
- **No change to any other `entity_type`.** This brief doesn't touch `moment`, `event`, or anything else.

---

## 5. Contact

One-line whitelist change. Ping Felicity when it's deployed — the FE flips on the moment the endpoint accepts the value; no coordinated rollout needed.

# Member `avatar_url` — stop baking in a default image on create

**Feature:** fix `POST /clubs/{club_id}/members` and `POST /clubs/{club_id}/members/invite` so brand-new members land with `avatar_url: null` instead of a server-side default (currently the active club's logo URL or a stock Torny placeholder). The CRM renders the initials bubble when `avatar_url` is null — that's the desired fallback for every member who hasn't personally uploaded a photo.

**Related briefs:**
- brief 12 (member add / edit / remove) — the Add + Invite endpoints that are seeding the default URL.
- brief 24 (club brand assets) — this is where the club logo URL comes from; the backend is reusing it as a member default.

**Status:** reported by Felicity on 2026-10-16 — Test Member on `/crm/members/{id}` shows the full Naenae Bowling Club shield in the hero avatar circle instead of `TM` initials. Same member in the search list shows the logo. Both views check `avatar_url` and render an `<img>` when it's non-null; the fix should start at the source.

---

## TL;DR

1. **Add + Invite responses currently return `avatar_url` set to the club logo** (or a `/stock-defaults/member.png`-style asset — same effect either way).
2. **The CRM uses `avatar_url` as "has a real photo"** — the roster hero and the row avatars both switch to the image renderer whenever `avatar_url` is non-null. There's no sentinel the frontend can detect without reaching back into `clubs.logo_url` for every row.
3. **Fix: on member create / invite, store NULL in `users.avatar_url`.** Don't copy the club logo. Don't fall back to a stock Torny asset. Null is correct — the frontend owns the "no photo" rendering.
4. Follow-up: run a one-time migration to NULL out any existing `users.avatar_url` rows where the value matches the owning club's `clubs.logo_url` (same CF Images ID, any variant). ~0.5s script on prod data.

---

## Repro

1. Sign in as owner of Naenae Bowling Club (has a logo set via Settings → Brand).
2. Go to `/crm/members` → **+ Add member** → fill in a name + email → **Add member**.
3. Click into the new member → hero renders the Naenae shield instead of initials.
4. Hit the API directly:

   ```bash
   curl -s -H "Authorization: Bearer <TOKEN>" \
     "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{naenae_club_id}/members?limit=200" \
     | jq '.data.members[] | select(.name == "Test Member") | .avatar_url'
   ```

   → returns something like `"https://imagedelivery.net/{account_hash}/{logo_image_id}/public"` — the club logo's own CF Images URL (optionally with a different variant suffix like `/thumbnail`).

5. Expected: `avatar_url` is `null` for Test Member, same as any other member who hasn't uploaded a photo.

---

## What the frontend currently does

Both the roster list (`apps/crm/src/views/members/MembersView.vue:329`) and the detail hero (`apps/crm/src/views/members/MemberDetailView.vue`) check `avatar_url`. If non-null AND hosted on `imagedelivery.net`, we render the `<img>`. We just added a workaround that extracts the CF Images ID from the URL and rejects it if it matches the club's logo ID — but that's a band-aid against this specific bug. Once the backend returns null, both views render the initials bubble naturally and the workaround can be deleted.

---

## Fix (backend)

### 1. On `POST /clubs/{club_id}/members`

In the `users` INSERT (new user path) and the `users` UPDATE path (linking an existing user):

- Do **not** write `avatar_url` from `clubs.logo_url`, environment config, or any stock default.
- Leave `avatar_url` alone (NULL for new users, untouched for existing users who may already have a photo).

### 2. On `POST /clubs/{club_id}/members/invite`

Same rule — `club_invites` rows shouldn't carry an `avatar_url` sourced from the club. When the invite is accepted and a `users` row is created, `avatar_url` stays NULL until the member uploads one.

### 3. On `GET /clubs/{club_id}/members`

If the fix above has shipped, the LIST response naturally returns `avatar_url: null` for members without a photo. No change needed here — just stop computing a fallback in the response serialiser if one exists.

### 4. Backfill migration

```sql
UPDATE users u
   SET avatar_url = NULL
  FROM user_clubs uc, clubs c
 WHERE u.id = uc.user_id
   AND uc.club_id = c.id
   AND u.avatar_url IS NOT NULL
   AND u.avatar_url !~ '/avatars/'                         -- real uploads live under a different path
   AND substring(u.avatar_url from 'imagedelivery\.net/[^/]+/([^/?#]+)')
     = substring(c.logo_url  from 'imagedelivery\.net/[^/]+/([^/?#]+)');
```

Adjust the `!~ '/avatars/'` guard to whatever path convention `POST /uploads/avatar` uses — the goal is "only null out rows where the stored avatar URL points at the same CF Images asset as the member's club logo".

---

## Response shape

Unchanged — all three endpoints still return `avatar_url: string | null`. The CRM already handles both branches; it just needs the backend to stop baking in defaults.

---

## Verification

```bash
# 1. Add a brand-new member — avatar_url should be null in the echo
curl -s -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{naenae_club_id}/members" \
  -d '{"email":"brand.new@example.com","first_name":"Brand","last_name":"New","send_invite":false}' \
  | jq '.data | {user_id, avatar_url}'
# → avatar_url: null

# 2. Invite path too
curl -s -X POST … -d '{"email":"invited@example.com","send_invite":true}' | jq '.data | {resolution, avatar_url}'
# → avatar_url: null

# 3. LIST query doesn't synthesise one
curl -s "GET /clubs/{naenae_club_id}/members?limit=200" | jq '.data.members[] | select(.avatar_url != null) | .name'
# → only names of members who have actually uploaded a photo

# 4. Post-backfill — Test Member shows null
psql -c "SELECT u.name, u.avatar_url FROM users u JOIN user_clubs uc ON uc.user_id = u.id WHERE uc.club_id = {naenae_club_id} AND u.name = 'Test Member';"
# → avatar_url: NULL
```

Pass criteria:

- Fresh members from Add / Invite land with `avatar_url: null`.
- The backfill migration zeroes out the historical club-logo defaults without touching any real uploaded avatar.
- Nev Rodda (who uploaded a real photo) still has his `imagedelivery.net/.../avatars/...` URL intact.

---

## Frontend will do

1. Once this ships, delete the `cfImageId()` + club-logo comparison in `MembersView.vue:hasRealAvatar` and `MemberDetailView.vue:hasRealAvatar`.
2. Collapse `hasRealAvatar` back to the single-line `return !!url && url.includes('imagedelivery.net')` check — null covers the rest.

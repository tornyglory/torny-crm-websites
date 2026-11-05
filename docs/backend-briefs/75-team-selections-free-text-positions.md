# Team selections — free-text positions + variable slot counts per team

**Feature:** let the admin name each slot in a team-selection freely and add / remove slots as the format demands. The existing editor hard-codes bowls positions (`Lead` / `Second` / `Third` / `Skip` / `Singles`) which locks Torny to one sport. This brief relaxes the backend so the same selection flow works for any sport (rugby `FH` / `No.8`, cricket `Opener` / `Keeper`, football `GK` / `CB` / `ST`, or anything else the committee wants to type).

**Status:** FE shipped alongside this brief. The editor now renders every slot's position as an inline-editable input with a `Player N` placeholder fallback, and each team has a `+ Add player` button + per-slot remove affordance. Values currently round-trip fine because the serializer sends the stored string straight into `UpdateRosterSlotInput.position` — but the backend's column type + validation reject anything outside the bowls enum. Until this brief ships, admins who type "Hooker" or "Opener" will get a 400 on the autosave PATCH.

**Related briefs:**
- **Brief 74** (team selections CRUD + notify) — original schema. This brief amends §3 `team_selection_slots.position` from an enum column to a short varchar + drops the roster PATCH validation that enforced the bowls set.
- **Brief 39** (role matrix) — unchanged; same `team:manage` scope.
- **Brief 77** (sports taxonomy) — note at the bottom. Different scope but adjacent; this brief doesn't block it.

---

## TL;DR

Three small changes, one migration:

1. **Widen the column.** `team_selection_slots.position` becomes `VARCHAR(40) NOT NULL DEFAULT ''` instead of the current bowls-only enum. No data migration needed — existing `Lead` / `Second` / `Third` / `Skip` / `Singles` values are valid varchars.
2. **Loosen roster PATCH validation.** The `/clubs/:cid/team-selections/:id/roster` endpoint stops rejecting unknown positions. It trims + length-caps the input (≤ 40 chars after trim) and accepts any string including empty — the FE already shows the `Player N` placeholder for blanks.
3. **Loosen create endpoint validation.** The `/clubs/:cid/team-selections` POST accepts the same free-text + empty strings in `format_shape.positions[]`. The FE now seeds presets as empty arrays (`['', '', '', '']` for fours, `['']` for singles) so admins name every slot inline after the selection is created — the create call will fail without this.
4. **No behavioural change to anything else.** Notifications, `preferred_position` matching, member autosuggest, published emails all keep working — they just render whatever string is there.

---

## 1. Schema change (migration 141)

```sql
-- BEFORE:
--   position TEAM_SELECTION_POSITION NOT NULL
-- (where TEAM_SELECTION_POSITION is an ENUM('Lead','Second','Third','Skip','Singles'))

ALTER TABLE team_selection_slots
    ALTER COLUMN position TYPE VARCHAR(40)
    USING position::text;

ALTER TABLE team_selection_slots
    ALTER COLUMN position SET DEFAULT '';

-- Keep the NOT NULL. Rows with the old enum text migrate verbatim.

-- Drop the enum type once no references remain.
DROP TYPE IF EXISTS TEAM_SELECTION_POSITION;
```

Also loosen the matching column on `users.preferred_position` so the member-autosuggest side of brief 74 can store "Captain" or "Flanker" too:

```sql
ALTER TABLE users
    ALTER COLUMN preferred_position TYPE VARCHAR(40)
    USING preferred_position::text;
```

(That column was nullable with the same enum — same transform.)

**Zero-downtime:** this is an in-place varchar conversion on both tables. On a read-committed instance it takes a brief ACCESS EXCLUSIVE lock; expect sub-second on typical selection volumes. No app-code rollout order required — the backend accepts the old enum values regardless.

---

## 2. Roster PATCH — validation changes

### Endpoint
```
PATCH /clubs/:cid/team-selections/:selectionId/roster
```

**Current rule (brief 74 §4):** server validates each slot's `position` against the enum, returning `400 invalid_position` on anything else.

**New rule:**
- Trim leading/trailing whitespace.
- Collapse internal whitespace runs to single spaces (optional but matches what the FE does on blur).
- Enforce `length ≤ 40` after trimming — reject with `400 position_too_long` if longer.
- Empty string is allowed; it just means "unnamed slot."
- No enum check. Store whatever string is submitted.

### Request shape (unchanged)
```jsonc
{
  "rinks": [
    {
      "id": 42,
      "label": "Team 1",
      "position": 0,
      "slots": [
        { "id": 101, "position": "Flanker",       "slot_order": 0, "member_id": 128 },
        { "id": 102, "position": "Hooker",        "slot_order": 1, "member_id": 221 },
        { "id": 103, "position": "",              "slot_order": 2, "member_id": null },
        { "id": null, "position": "Reserve",      "slot_order": 3, "member_id": null }
      ]
    }
  ]
}
```

### Error codes

| HTTP | code                  | when                                              |
|------|-----------------------|---------------------------------------------------|
| 400  | `position_too_long`   | any slot's `position` > 40 chars after trim      |
| 400  | `invalid_slot_order`  | (unchanged) non-integer or negative              |
| 403  | `forbidden`           | caller doesn't have `team:manage`                |
| 404  | `selection_not_found` | selection id isn't on this club                  |
| 409  | `selection_locked`    | status is `sent`, `played`, or `cancelled`       |

Remove: `invalid_position` from the brief 74 error table. Clients can keep catching it defensively for a release cycle; the server never emits it again.

### Idempotency / notify / diff behaviour

**Nothing else changes.** Notification diffing (brief 74 §6) keys off `member_id` per `(rink_id, slot_order)` pair, not off `position`. Renaming a slot from "Lead" to "Captain" with the same member does **not** fire a dropped+picked notification — it's a cosmetic edit.

Published email templates that reference `{{slot.position}}` just render whatever string is there. No breakage.

---

## 3. Create endpoint — validation changes

### Endpoint
```
POST /clubs/:cid/team-selections
```

### What changes

The `format_shape` object on the create payload carries a `positions: string[]` that the backend uses to seed slots when inserting the selection. Brief 74 §2 restricted those entries to the bowls enum. **That restriction is dropped.** Validation mirrors § 2:

- Each entry is trimmed.
- `length ≤ 40` after trim — reject with `400 position_too_long` if longer.
- Empty strings are allowed; the backend stores `''` on the seeded slot and the FE renders the `Player N` placeholder.
- No enum check.
- `positions.length` must still be `1..8` (unchanged — this is the per-team slot count).
- `rink_count` validation (`1..8`) is unchanged.

### FE change that depends on this

As of this brief, the FE's `createPresets` map sends empty arrays by default:

```ts
fours:   { positions: ['', '', '', ''], rink_count: 2 }
triples: { positions: ['', '', ''],     rink_count: 2 }
pairs:   { positions: ['', ''],         rink_count: 2 }
singles: { positions: [''],             rink_count: 1 }
```

**Without this change the create endpoint will 400 on every new selection** — the presets drive the create payload for every admin, bowls or otherwise. This is the gating ship-order rule: deploy the backend change before the FE change reaches users, or roll the FE back to the old bowls defaults.

### Request shape (example)

```jsonc
POST /clubs/5/team-selections
{
  "competition":   "Interclub",
  "round_label":   "Round 6",
  "opponent":      "Island Bay",
  "venue":         "home",
  "starts_at":     "2026-11-14T12:30:00+13:00",
  "format_label":  "Fours × 2",
  "format_shape":  {
    "positions":   ["", "", "", ""],
    "rink_count":  2
  },
  "manager_note":  "Meet out at their club. Get there at 12pm."
}
```

### Error codes

Same error table as § 2 applies to `format_shape.positions[]` entries:

| HTTP | code                  | when                                                    |
|------|-----------------------|---------------------------------------------------------|
| 400  | `position_too_long`   | any `format_shape.positions[]` entry > 40 chars         |
| 400  | `invalid_positions`   | `positions.length` outside `1..8`                       |
| 400  | `invalid_rink_count`  | `rink_count` outside `1..8`                             |
| 403  | `forbidden`           | caller doesn't have `team:manage`                       |

Remove `invalid_position` from the brief 74 create error table — same as the roster PATCH change.

---

## 4. GET endpoints — response shape

No field additions. The `position` field on every return shape (list rows, detail, roster slots on `TeamSelectionSlot`) stays as-is; only the type widens from the enum to a plain string.

### Backward-compatible contract summary

| Shape                         | Field                       | Type change                                             |
|-------------------------------|-----------------------------|---------------------------------------------------------|
| `TeamSelectionSlot`           | `position`                  | `TeamSelectionPosition` enum → `string` (≤ 40)         |
| `TeamSelectionMemberSnapshot` | `preferred_position`        | same                                                    |
| `UpdateRosterSlotInput`       | `position?`                 | same                                                    |
| `CreateFormatShape.positions` | `positions: string[]`       | element type widens same way                           |

(Clients built against the bowls-only enum keep compiling against a `string` superset — no breaking change at the type level.)

---

## 5. Seed data (format presets) — FE change already live

Brief 74 §2 listed four format presets that the CRM used to seed a new selection with bowls-specific position names. **The FE updated those presets to blank arrays** so the slot count per team stays sport-neutral and the editor's `Player N` placeholder guides the admin:

```
// NEW — what the FE sends today
fours:   { positions: ['', '', '', ''], rink_count: 2 }
triples: { positions: ['', '', ''],     rink_count: 2 }
pairs:   { positions: ['', ''],         rink_count: 2 }
singles: { positions: [''],             rink_count: 1 }
```

The preset labels (`Fours`, `Triples`, `Pairs`, `Singles`) stay — they're useful format shorthand for bowls clubs and mean "N players per team" for other sports. The preset bodies are now sport-neutral.

- If the backend has anywhere else that validates `format_shape.positions[]` against the enum (e.g., a stored-procedure check on an `email_batches` template render), drop it there too.
- Future presets can be added freely — e.g. `elevens: { positions: Array(11).fill(''), rink_count: 1 }` for football — with zero backend work once this brief ships.

---

## 6. FE contract summary

`packages/api-client/src/resources/teamSelections.ts` already widened:

```ts
// Before
export type TeamSelectionPosition = 'Lead' | 'Second' | 'Third' | 'Skip' | 'Singles'

// After (shipped alongside this brief)
export type TeamSelectionPosition = string
export const BOWLS_POSITIONS = ['Lead','Second','Third','Skip','Singles'] as const
```

The `BOWLS_POSITIONS` tuple is exported for anywhere we want to offer autocomplete / preset chips for bowls clubs; it's not enforcement.

The editor (`apps/crm/src/views/teams/TeamEditorView.vue`) now:
- Renders each slot's position as an `<input>` with a `Player N` placeholder.
- Exposes `+ Add player` per team to append a blank slot.
- Exposes a per-slot `×` remove button (appears on hover / focus-within).
- Re-indexes `slot_order` on remove so the server-side diff doesn't see gaps.
- Reuses the existing 800 ms `scheduleSave()` debounce — identical behaviour to the team-name inline editor, nothing new in the save path.

---

## 7. Verification — curl

Using Nigel's JWT (owner of Naenae = `club_id = 5`), against an existing selection:

```bash
# 1. Rename a slot to an arbitrary sport term — formerly 400.
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections/$SID/roster" \
  -d '{"rinks":[{"id":42,"position":0,"label":"Team 1","slots":[{"id":101,"position":"Flanker","slot_order":0,"member_id":128}]}]}'
# → 200, slot persists as "Flanker".

# 2. Append a new slot (no id) + one existing.
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections/$SID/roster" \
  -d '{"rinks":[{"id":42,"position":0,"slots":[
        {"id":101,"position":"Captain","slot_order":0,"member_id":128},
        {"position":"Reserve","slot_order":1,"member_id":null}
      ]}]}'
# → 200, new slot gets a server id in the response.

# 3. Over-long position → 400 position_too_long.
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections/$SID/roster" \
  -d '{"rinks":[{"id":42,"position":0,"slots":[{"id":101,"position":"'$(printf 'x%.0s' {1..50})'","slot_order":0}]}]}'
# → 400 { code: "position_too_long" }

# 4. Empty position is fine (admin is still deciding what to name it).
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections/$SID/roster" \
  -d '{"rinks":[{"id":42,"position":0,"slots":[{"id":101,"position":"","slot_order":0,"member_id":128}]}]}'
# → 200, position stored as "".

# 5. Rename back to a bowls value — still works.
curl -X PATCH -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections/$SID/roster" \
  -d '{"rinks":[{"id":42,"position":0,"slots":[{"id":101,"position":"Lead","slot_order":0,"member_id":128}]}]}'
# → 200. Legacy clients built before this brief continue to work.

# 6. Create a brand-new selection with the FE's new empty-array presets.
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections" \
  -d '{"competition":"Interclub","round_label":"Round 6","opponent":"Island Bay","venue":"home","starts_at":"2026-11-14T12:30:00+13:00","format_label":"Fours × 2","format_shape":{"positions":["","","",""],"rink_count":2}}'
# → 201. 2 rinks x 4 slots each, every slot.position = "".

# 7. Create with explicit sport-specific labels — rugby fifteen.
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/team-selections" \
  -d '{"competition":"Prems","round_label":"R3","opponent":"Petone","venue":"home","starts_at":"2026-11-15T14:00:00+13:00","format_label":"XV","format_shape":{"positions":["LHP","Hooker","THP","Lock","Lock","Flanker","Flanker","No.8","Halfback","First five","Second five","Centre","Wing","Wing","Fullback"],"rink_count":1}}'
# → 201. One team with 15 slots named per the sent array.
```

Pass criteria:
- ✓ Non-bowls strings persist and round-trip (PATCH + POST paths).
- ✓ Empty string persists and round-trips (PATCH + POST paths).
- ✓ Over-40-char strings reject with `position_too_long` on both endpoints.
- ✓ `GET /clubs/:cid/team-selections/:id` returns the stored string verbatim.
- ✓ Notify diff still fires only when `member_id` changes on a `(rink_id, slot_order)` pair — renames alone don't notify.
- ✓ Publish + email send still render the position as-is.
- ✓ Create with empty `format_shape.positions[]` entries seeds slots with `position = ''` — no 400.

---

## 8. Non-goals (v1)

- **No sport-aware validation.** Backend doesn't care what sport the club plays; any 40-char string is valid. Club-level sport taxonomy is brief 77's scope.
- **No position autocomplete API.** Admins type their own labels. If we later want saved chips ("your club's roles"), that's a new resource (`GET /clubs/:cid/positions`) — not part of this brief.
- **No member-side position picker rework.** Members who set a `preferred_position` on their profile still type whatever they want. Matching in the editor is already a substring/startswith suggestion — no change needed.
- **No bulk-rename tool.** Admins rename one slot at a time in the editor. If clubs ask for "rename all 'Lead' slots in this selection to 'Captain'," we revisit.
- **No per-position colour / avatar hints.** The FE uses the position string purely as a label today.

---

## 9. Contact

**Ship order matters here** — unlike most briefs where the FE rides behind the backend, this one is already shipped FE-side:

1. The editor now renders every slot's position as an editable `<input>` and every autosave PATCH sends whatever the admin typed. Until § 2 ships, those saves will 400 on anything non-bowls.
2. The create-selection form now sends `format_shape.positions: ['', '', '', '']` by default. Until § 3 ships, creating a brand-new selection will 400 on **every** admin, bowls or otherwise — this is the acute one.

So the ship-order is: backend deploy §§ 1–3 together, FE is already there waiting. Ping Felicity when the deploy lands so she can smoke-test a create + a rename and clear any downstream alerting.

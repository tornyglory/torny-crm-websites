# Add fullBleedMedia to the page-save block-type allowlist

**Feature:** add `'fullBleedMedia'` to the known-block-types tuple used by `PATCH /clubs/{club_id}/pages/{page_slug}`. Audit the same tuple against the current FE block list while we're in there, since the allowlist probably hasn't been synced since the FE was at ~8 block types and it's now at ~25.

**Status:** backend not started. Blocks the brief 58 release — admins can see the `fullBleedMedia` block in the palette and configure it in the inspector, but every autosave 400s with `unknown_block_type` so the draft never persists.

**Related briefs:**
- brief 58 (block video uploads) — this is the companion fix. 58 shipped the upload pipeline; this un-blocks the save.
- brief 18 (block images), brief 15 / 16 (site payload) — not touched; mentioned for context.

---

## 1. What's happening

The pages PATCH validator rejects any `block.type` that isn't on a hardcoded list. From `packages/api-client/src/resources/pages.ts:174`:

> *"`type` is one of the 8 known → 400 `unknown_block_type` (with `type` echoed)"*

Current symptom:

```
PATCH → /clubs/42/pages/home   (layout_draft includes { type: "fullBleedMedia" })
← 400  { code: "unknown_block_type", type: "fullBleedMedia" }
```

The FE catches this and shows `Unknown block type "fullBleedMedia" — refresh to reset`. The draft never lands server-side; a refresh wipes the admin's work. From the admin's POV, the feature doesn't work.

---

## 2. The fix

Add this one string to whatever the current allowlist is called (likely `KNOWN_BLOCK_TYPES` or similar):

```
'fullBleedMedia'
```

That's it for the immediate release-blocker.

---

## 3. Audit the rest of the list while you're there

The doc comment says `one of the 8 known` — we've been well past 8 for a while. The following types are all currently referenced by the FE and almost certainly need to be on the allowlist too. Please cross-check and add any that are missing in the same PR:

| Type | Shipped |
|---|---|
| `hero` | ≤ v1 |
| `richText` | ≤ v1 |
| `eventList` | brief 10 era |
| `eventsCalendar` | brief 33 |
| `honourBoard` | brief 31 |
| `honourBoardSearch` | brief 31 |
| `tournamentSearch` | brief 47 |
| `upcomingTournamentsList` | brief 47 |
| `upcomingTournamentHero` | brief 47 |
| `membersSearch` | brief 35 era |
| `membershipJoinForm` | brief 38 |
| `peopleGrid` | brief 43 |
| `venueHireHero` | brief 44 |
| `venueSpaces` | brief 44 |
| `venuePackages` | brief 44 |
| `gallery` | brief 43 |
| `contactForm` | brief 41 |
| `membershipCta` | editorial pass |
| `ctaBanner` | editorial pass |
| `mediaSplit` | editorial pass |
| `sectionTitle` | editorial pass |
| `pullQuote` | editorial pass |
| `featureGrid` | editorial pass |
| `faqAccordion` | editorial pass |
| `fullBleedImage` | editorial pass |
| `fullBleedMedia` | **brief 58 — the one you're adding** |
| `timeline` | editorial pass |
| `twoColumn` | editorial pass |
| `divider` | editorial pass |

Reality check: no admin has been able to save a page with any of the "editorial pass" types that landed since the backend's last audit. If a club admin has placed those via the palette and never hit save-fail, that's because the autosave debounce + manual publish timing may have hidden it. Worth confirming.

**Canonical source:** `packages/content-blocks/src/types.ts` → `type BlockType = …` is the full union the FE ships. That's the list to sync against.

---

## 4. Future workflow — avoid the drift

Two options for keeping these in sync. Not blocking this release; just worth deciding on so we don't play whack-a-mole on every new block.

**Option A (recommended): shared source of truth.**
Move the type list into a tiny JSON file in the repo root — `shared/block-types.json` — and have both the backend validator and the FE's `BlockType` union read from it (FE via a build-time import, backend via a Python / Go read at startup). One PR adds a type, both sides pick it up.

**Option B: process reminder.**
Add a line to the "adding a new block" checklist that says "update `KNOWN_BLOCK_TYPES` in `<backend path>`." Cheaper to implement, higher chance of being missed in review.

My preference is **A** — low effort, zero coordination cost going forward, and we don't lose the structural guardrail of "the server knows what types are legal."

---

## 5. Scope not included

- Dropping the type validator entirely. The allowlist catches real client bugs (null types, typos from a broken FE build) — removing it just because syncing is a chore isn't the right trade.
- Prop-shape validation per block type. We're not asking for anything new, just syncing the type list.
- Removing the `unknown_block_type` catch from the FE. Keeps as dead code until all legit types are allowlisted; harmless.
- The publish handler (`POST /pages/:slug/publish`) — assuming it reuses the same validator. If it has its own, apply the same addition + audit there too.

# Rollback runbook

What to do when a deploy breaks production. One section per deploy surface. Every rollback follows the same shape: **signal → decide → execute → coordinate → verify**.

If you're reading this during an incident, skip the preamble and jump to the section for the broken surface.

- [CRM — Azure Static Web Apps](#crm--azure-static-web-apps)
- [Club sites (Nuxt) — Cloudflare Pages](#club-sites-nuxt--cloudflare-pages)
- [Marketing site (torny-web) — Cloudflare Pages](#marketing-site-torny-web--cloudflare-pages)
- [Decision framework (revert vs hotfix)](#decision-framework)
- [After the incident](#after-the-incident)

---

## CRM — Azure Static Web Apps

**App:** `apps/crm` → Azure SWA at `app.torny.pro`
**Deploy workflow:** `.github/workflows/crm-azure-swa.yml` (triggers on push to `main` affecting `apps/crm/**`, `packages/**`, `pnpm-lock.yaml`)
**Deploy artefact:** compiled Vite bundle uploaded as a SWA deployment

### Signal — how do I know it's broken?

1. **Sentry spike.** <https://torny.sentry.io/issues/?project=4512483265806336> — new issues firing at a rate higher than the previous hour's baseline, or a spike in `Error Count` on existing issues. The release tag (e.g. `cd5b95e2e4f40c0d0db2f68d6d87c074960443a9`) is the git SHA of the broken deploy.
2. **User report** via support / Slack / direct message. Classic signals: "page is blank," "I can't sign in," "button does nothing."
3. **Manual sanity check** after any risky deploy — load `app.torny.pro`, open DevTools, click through sign-in → dashboard → members list. 90 seconds.

### Decide — revert vs hotfix

Use the [decision framework](#decision-framework) below. Short version:
- **Revert** if the broken deploy's blast radius is wide and the fix isn't obvious in 10 minutes.
- **Hotfix forward** if you can diagnose and patch within a few minutes AND it's safer than reverting (e.g. when reverting would re-expose a different bug, undo a security fix, or require coordinated backend rollback).

### Execute — the script path (default)

Use the automation. Covers 95% of CRM rollbacks.

```sh
./bin/rollback-crm.sh            # dry-run: shows what would be reverted
./bin/rollback-crm.sh --yes      # actually revert the last commit + push
./bin/rollback-crm.sh 2 --yes    # revert the last 2 commits + push
```

The script:
- Reverts the most recent N commit(s) on `main` and pushes
- Triggers the `crm-azure-swa` workflow — redeploys in ~2 minutes
- Refuses to run on a dirty tree, a non-`main` branch, or when local is out of sync with `origin/main`
- Dry-runs by default — nothing happens without `--yes`
- Prints the deploy workflow URL + Sentry URL so you can watch recovery

**Agent protocol** — if an AI agent (Claude Code or similar) is asked to rollback the CRM:

1. **Always** run `./bin/rollback-crm.sh` (no args) first and share the output with the human. This confirms what would be reverted without touching anything.
2. Wait for explicit human confirmation (e.g. "yes, revert" or "proceed").
3. Only then run `./bin/rollback-crm.sh --yes` (or `./bin/rollback-crm.sh N --yes` if the human specified a count).
4. Watch the redeploy workflow with `gh run watch` on the triggered run.
5. Report: new main SHA, the SHA(s) that were reverted, and a link to the Sentry issue feed.

Autonomous rollback (no human confirmation) is not supported today. If we add it later, it goes behind an explicit flag the agent must pass.

### Execute — fallbacks

**Fallback 1: manual git revert**

If the script fails for a reason you can fix (merge conflict on revert, out-of-sync local), do the revert by hand. Same net effect:

```sh
git fetch origin main
git revert <bad-sha> --no-edit
git push origin main
```

**Fallback 2: Azure SWA environment swap (no git)**

Use when git is unavailable OR the reverted state might also be broken (e.g. the dep graph is in a bad state across multiple commits).

1. Azure portal → your Static Web App → **Environments**.
2. The **Production** environment lists its deployment history. Pick a prior good deploy by commit SHA.
3. **Set as Production.**
4. Takes effect within ~30 seconds.

Fallback 2 leaves prod ahead of `main` — fix it afterwards by reverting the bad commit(s) on main so the branch matches prod.

### Coordinate

- **Sentry:** after rollback, the bad release should stop firing new issues. If it keeps firing, something else is wrong.
- **Backend:** CRM revert is pure FE — no backend coordination needed unless the broken change was coupled with a backend brief that shipped simultaneously. Check the PR body / commit message.
- **Users:** if anyone was blocked for more than a few minutes, post in Slack / the team channel once service is restored.

### Verify

- Reload `app.torny.pro` in a fresh incognito window.
- Sign in, navigate to the broken area, confirm it works.
- Watch Sentry Issues feed for 5 minutes — new events for the bad release should fall to zero.

---

## Club sites (Nuxt) — Cloudflare Pages

**App:** `apps/club-sites` → Cloudflare Pages project `torny-crm-websites`
**Deploy:** Cloudflare Pages auto-deploys on push to `main` (set up via the CF dashboard — not via GitHub Actions)
**URL pattern:** every club's public site, routed via `<slug>.torny.pro` through the CF tenant-router Worker

### Signal

1. Sentry doesn't currently cover the club sites (follow-up in `docs/production-readiness/03-sentry.md`). Signal comes from:
   - **User report** — club admin says their site is blank / 500ing.
   - **Cloudflare Pages dashboard** — the failing deploy will show as red in <https://dash.cloudflare.com> → Pages → `torny-crm-websites` → Deployments.
2. Smoke check: load any live club's subdomain, e.g. `naenaebowls.torny.pro`.

### Decide

Same framework as CRM. Difference: blast radius is **every club's public site**. Prefer fast rollback.

### Execute

**Option A: CF Pages rollback (one click)**

1. <https://dash.cloudflare.com> → Pages → `torny-crm-websites` → **Deployments** tab.
2. Find the last successful deploy (green checkmark) before the broken one.
3. Three-dot menu → **Rollback to this deployment**.
4. Takes effect in ~30 seconds.

This is the preferred path — doesn't touch git, instantly reversible, visible audit trail in the CF dashboard.

**Option B: Git revert + push**

1. `git revert <bad-sha> --no-edit && git push origin main`
2. CF Pages picks up the push and builds + deploys — typically 60–90 seconds.

Use B when the git history needs to reflect the revert (e.g. the bad change is poisoning other package consumers).

### Coordinate

- **KV namespace** (`TORNY_KV`): maps hostnames to club IDs. Not touched by a FE revert. If the incident involves wrong data in KV, revert is NOT enough — see the `wrangler kv` CLI docs.
- **Backend:** if the broken change paired with a backend brief that shipped simultaneously, the revert alone may re-break something else. Confirm via the PR body.

### Verify

- Load one live club subdomain in incognito.
- Check CF Pages → Deployments shows the rolled-back deploy as current.

---

## Marketing site (torny-web) — Cloudflare Pages

**App:** `apps/torny-web` → Cloudflare Pages project (separate from club-sites)
**Deploy:** CF Pages auto-deploy on push to `main`
**URL:** `torny.pro` (root domain)

### Signal

Same as club-sites — no Sentry yet. User reports + dashboard.

### Execute

Identical to club-sites, in the `torny-web` CF Pages project instead.

### Coordinate

Lower blast radius than club-sites — marketing site is static content, breakage affects visitors but not existing users.

---

## Decision framework

| Situation | Choose |
|---|---|
| Error rate < 0.5% of users, fix obvious + tested locally in <10 min | **Hotfix forward** |
| Error rate > 5% of users, OR auth / payment / signup broken | **Revert immediately, diagnose after** |
| Broken change was coupled with a backend brief that shipped | **Coordinate with backend** — may need parallel rollback |
| Broken change contained a security fix (XSS sanitizer, CSP) | **Hotfix forward** if possible — revert re-opens the vulnerability |
| Multiple deploys since the broken one, revert would undo good work | **Hotfix forward, cherry-pick good commits later** |

When in doubt, revert. You can always re-ship the good commits afterwards. You can't un-break a user mid-session.

---

## After the incident

1. **Write a one-paragraph note** in the incident day's section of your journal / CLAUDE.md working log. What broke, what you did, how long it took to recover.
2. **If the cause was a missing guard** (lint, test, type), add the guard so it can't happen again. Common culprits for this codebase: untested store mutations, lazy-chunk hash mismatches, env var typos.
3. **If reverting left prod ahead of main** (Azure SWA Option B, CF Pages Option A), reconcile:
   - Revert the bad commit on main so the branch matches prod.
   - Re-redeploy if necessary.
4. **Dry-run this runbook** quarterly. Pick a safe prior deploy and walk through "what would I click?" without actually rolling back. Catches drift when the deploy platforms update their UIs.

---

## Related

- Rollback script: [`bin/rollback-crm.sh`](../../bin/rollback-crm.sh) — dry-runs by default, agent-executable, handles the common case.
- Deploy workflow for CRM: [`.github/workflows/crm-azure-swa.yml`](../../.github/workflows/crm-azure-swa.yml)
- Branch protection config: see this repo's **Settings → Branches** — enforces `verify` green before merge, admin bypass preserved for break-glass.
- PR template: [`.github/pull_request_template.md`](../../.github/pull_request_template.md) — rollback plan is a required section on every PR.
- Sentry project: <https://torny.sentry.io/issues/?project=4512483265806336>

# 02 · Dependabot for dependency vulnerability scanning

**Status:** complete
**Date:** 2026-11-11
**Priority:** Day-2 (medium-severity gap on the audit)
**Related:** [`audit-2026-11-11.md`](./audit-2026-11-11.md) → Security §4

## The risk

No automated dependency scanning. CVEs accumulate silently. Over 6–12 months a critical vulnerability in a transitive dep lands, nobody notices until the first `pnpm audit` after an incident. Meanwhile `pnpm-lock.yaml` falls further behind and the eventual catch-up becomes a large, risky bump.

`.github/dependabot.yml` was absent. No `renovate.json` either. CI runs lint + typecheck + test but no `pnpm audit`.

## Approach

Dependabot over Renovate because:

- Native GitHub integration (no third-party app install needed)
- Supports pnpm workspaces via the shared root `pnpm-lock.yaml`
- Config lives in-repo and is reviewable
- Free for public and private repos

## Config decisions

1. **One `npm` entry at root.** The pnpm workspace has a single `pnpm-lock.yaml` covering all apps/* and packages/*. Dependabot resolves updates across workspaces via that lockfile — no need for per-workspace entries.
2. **Weekly, Monday 08:00 Pacific/Auckland.** Keeps PR noise down and lands bumps before the week starts so the team has focus time to review.
3. **Groups.** Patch + minor bumps batched into two PRs per week (prod, dev). Major bumps still flow as individual PRs.
4. **Major-version ignores on load-bearing deps.** `vue`, `nuxt`, `vite`, `typescript`, `vitest` + `@vitest/*` — these need manual migration work. Patch/minor still flow via the groups.
   - **vitest major** is also blocked by a Dependabot limitation (on top of the usual manual-migration reason): when a dep is declared in multiple pnpm workspace subpackages, Dependabot's updater steps into one of those subdirectories, pnpm detects the parent workspace, and the job dies with `misconfigured_tooling: Updating workspaces from inside a workspace subdirectory is not supported`. Seen on the 2.x → 5.x attempt (2026-11-25). Until Dependabot ships proper pnpm workspace handling, bump vitest manually at the root: `pnpm -r up -L vitest@latest` then `pnpm -r test` to validate.
5. **GitHub Actions ecosystem.** Keeps `actions/checkout`, `pnpm/action-setup`, `Azure/static-web-apps-deploy` pinned to current versions.
6. **`open-pull-requests-limit: 10`.** Keeps the queue manageable if a backlog builds up.

## What this doesn't do

- Doesn't scan for *known* CVEs in the current lockfile — Dependabot's security updates do that, but you need to enable "Dependabot security updates" + "Dependabot alerts" in repo Settings → Code security separately.
- Doesn't run `pnpm audit` in CI — complementary, worth adding later as a non-blocking check.
- Doesn't auto-merge. PRs need review + CI green. Appropriate until the test suite covers more than the current ~6–8% unit coverage.

## Follow-ups

- **Enable Dependabot alerts + security updates in repo settings.** GitHub-side toggle, 10 seconds. Without this, you only get *scheduled* dep bumps, not *urgent* CVE-driven ones.
- **Add `pnpm audit --audit-level high` as a non-blocking CI step** so human review of CVEs is routine.
- **Decide on auto-merge policy** once unit coverage grows. For now, humans gate every merge.

## Changelog

### 2026-11-11

- Created `.github/dependabot.yml` with the config above.
- Documented rationale here.

<!--
Short template. Delete sections that don't apply — don't leave stub headings.
The goal: everyone can read the title + first three sections and know what,
why, and how to undo it. See docs/runbook/rollback.md for the rollback process.
-->

## What

<!-- One sentence. The commit subject usually works. -->

## Why

<!-- Link to the brief / audit doc if there is one:
       docs/backend-briefs/NN-…
       docs/production-readiness/NN-…
     For a bug fix, name the symptom and root cause in one line. -->

## Test plan

<!-- Required. Check what you ran. Add rows for anything else. -->

- [ ] `pnpm --filter @torny/crm typecheck`
- [ ] `pnpm --filter @torny/crm test`
- [ ] `pnpm --filter @torny/crm test:e2e`
- [ ] Manual browser check on the touched page(s)

<!-- Describe any non-obvious verification (e.g. "paste XSS payload
     into signature editor, confirm it renders as text"). -->

## Rollback plan

<!-- How we undo this if it breaks prod. Pick one and keep it short:
     - Revert the commit. No data changes, no migrations.
     - Revert + redeploy via Azure SWA portal — see docs/runbook/rollback.md.
     - Requires backend brief NN to roll back in parallel.
     - N/A — docs / test-only change.
-->

## Deploy notes

<!-- Only if something deploy-time matters. Delete this section otherwise.
     Examples:
     - New env var VITE_X_API_URL needed in Azure SWA + GitHub secrets.
     - Must land after backend brief NN is live.
     - Breaking type change in @torny/api-client — rebuild club-sites too.
-->

## Screenshots

<!-- Required for UI changes. Before / after. Delete this section otherwise. -->

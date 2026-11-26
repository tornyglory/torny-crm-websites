# Brief 123 — Admin portal FE build plan

**Status:** plan only, nothing shipped. Consumes brief 123 Phase 1 (live 2026-11-26, commit `562541b`). FE build phases are **A → B → C** below; **D** and **E** wait on backend Phase 2/3.

Companion to:
- `123-admin-portal-redesign.md` — original product brief
- `123-admin-portal-redesign-live.md` — backend's live shape + verification
- `packages/api-client/src/resources/admin.ts` — typed wrapper, already shipped

---

## 1. What we're building

A new platform admin shell inside the CRM (same app, same subdomain, route-gated by `is_platform_admin`). Replaces the current claims-based admin — which was designed around approving club registrations, a workflow that no longer exists now that signup is self-serve.

The new shell's value prop in one line: **"show every paying + non-paying tenant, how much they're using Torny, how much Torny earns on each — and surface the ones to pay attention to."**

Not building (deferred, called out in §7):
- Impersonate / comp-plan / suspend UI — waiting on backend Phase 2
- Transactions drilldown + Communications tab — waiting on backend Phase 3
- System health panel — waiting on backend Phase 3
- CSV export, sparkline charts, multi-currency, RBAC for sub-admin roles — non-goals

---

## 2. What we're deleting

Delete in the same PR as Phase A so the sidebar doesn't carry dead links:

**Files:**
- `apps/crm/src/views/admin/AdminClaimsView.vue` (if exists)
- `apps/crm/src/views/admin/AdminClaimDetailView.vue` (if exists)
- `apps/crm/src/views/admin/AdminMembersView.vue` — platform-level cross-tenant members list; privacy + no use case
- `apps/crm/src/stores/claims.ts`
- `packages/api-client/src/resources/claims.ts`

**Routes to remove from `apps/crm/src/router/index.ts`:**
- `/admin/claims`, `/admin/claims/:id`
- `/admin/members`

**Nav items:** "Claims" and "Members" from the admin sidebar.

**Keep but reshape:**
- `AdminOverviewView.vue` → renamed `AdminDashboardView.vue`, rewritten against the metrics endpoints (not merely patched)
- `AdminUsersView.vue` → stubbed in Phase C with "Coming in the next ship" state until backend Phase 2 lands the reshape
- Existing admin layout / sidebar shell → reused, just with a new nav + the old items pruned

**Backend already returns `410 Gone` on `/admin/claims*` endpoints** (per live doc §13), so the current CRM `/admin/claims` view is already broken-in-practice today. Deletion is safe immediately.

---

## 3. Information architecture

### 3.1 Routes

| Route | Phase | Purpose |
|---|---|---|
| `/admin` | A | Redirect → `/admin/dashboard` |
| `/admin/dashboard` | A | Overview metrics + the "signals" (past-due, flagged, etc.) |
| `/admin/accounts` | A | Accounts list — the core workhorse view |
| `/admin/accounts/:id` | B | Account detail with tabs |
| `/admin/billing` | B | Billing dashboard (subscription + transactional split) |
| `/admin/users` | C | Platform users — stubbed empty until backend Phase 2 |
| ~~`/admin/claims`~~ | — | Deleted |
| ~~`/admin/claims/:id`~~ | — | Deleted |
| ~~`/admin/members`~~ | — | Deleted |

All routes share a `beforeEnter` guard that rejects non-platform-admins to `/crm` with a toast.

### 3.2 Sidebar nav (new order)

```
Dashboard
Accounts
Billing
Users          — "coming soon" state until Phase 2
```

Four items, flat. No category headings — the admin surface is small enough.

### 3.3 Account detail tabs (route: `/admin/accounts/:id`)

Default to Overview. Tabs preserve `?tab=` in the URL for bookmarkability.

| Tab | Phase | Shows |
|---|---|---|
| Overview | B | Row metrics + timeline + action buttons (disabled until Phase 2 wires actions) |
| Transactions | E (Phase 3 backend) | Polymorphic list of bookings + entries + charges |
| Communications | E (Phase 3 backend) | Email batch history + bounce stats |
| Content & members | E (later) | Pages published + member tier breakdown |

Phase B ships Overview only; the other tabs render a "coming soon" placeholder but reserve their nav slot so the URL contract is forward-compatible.

---

## 4. Component inventory

Build in `apps/crm/src/components/admin/` unless noted. Prefix all new admin-only components with `Admin*` so grep stays easy.

### 4.1 Shell + nav (reuse mostly, trim claims/members)

- `AdminShell.vue` — layout wrapper. Likely already exists; audit + prune nav items.
- `AdminSidebar.vue` — nav links per §3.2. Active-route styling.

### 4.2 New shared primitives

- `AdminWindowToggle.vue` — segmented control: 7d · 30d · 90d · YTD · All. Emits `update:window`. URL-driven state (see §5).
- `AdminMetricCard.vue` — big number + label + delta + optional sparkline (sparkline hidden when backend trend array is empty — Phase 1 reality).
- `AdminMoney.vue` or `formatCents()` util — single source of truth for cents → "$12,345.67 NZD" formatting. Reuse the `fmtMoney` helper from the CRM if it exists; add if not.
- `AdminTimelineList.vue` — chronological events. Icon + title + relative time (`2h ago`). Unknown `kind` values render as a generic chip with raw `detail` JSON — per live doc §3 the backend will add kinds without an FE deploy.
- `AdminFlagBadges.vue` — compact pill row for the account row's `flags` object (`past_due`, `suspended`, `comped`, `high_bounce`). Shows only non-false flags.
- `AdminEmptyState.vue` — shared empty state for "no results" / "coming soon" / "deferred to Phase X".

### 4.3 View-specific

- `AdminAccountsTable.vue` — sortable columns, filter chips, cursor pagination ("Load more" button, not infinite scroll). Sticky header. Click row → account detail.
- `AdminAccountsFilters.vue` — filter chip row (Plan · Status · Inactive >Nd · Has transactions). Debounced search input.
- `AdminDashboardTiles.vue` — grid of MetricCards for the Dashboard view.
- `AdminBillingSummary.vue` — subscription + transactional split for the Billing view.
- `AdminAccountOverviewTab.vue` — the detail-view Overview tab body.

### 4.4 Action placeholders (Phase D wires up)

- `AdminActionBar.vue` — on account detail, renders three buttons: **Impersonate**, **Comp plan**, **Suspend**. All disabled with tooltip "Available in a future ship" until backend Phase 2. Reserve the UX slot so Phase D is pure wiring.

---

## 5. State + data flow

No new Pinia stores. All admin data is read-mostly and URL-driven. Follow the `useClubPlan` pattern from the block-picker work.

### 5.1 Composables

- `useAdminWindow()` — reads `?window=` from the route, defaults to `30d`. Writes propagate via `router.replace()` so the back button works. All three windowed views read from this one source.
- `useAdminAccounts(params)` — wraps `admin.listAccounts()`, exposes `items`, `nextCursor`, `totalCount`, `loading`, `error`, `loadMore()`, `refresh()`. Cancels in-flight requests on param change via `AbortController`.
- `useAdminAccount(id)` — wraps `admin.getAccount()`. Single-row + timeline.
- `useAdminMetrics(which: 'overview' | 'billing')` — wraps `metricsOverview` / `metricsBilling`. Refetches on window change.

Keep each composable self-contained — no cross-dependencies. A view can compose multiple composables but composables don't import each other.

### 5.2 Window toggle is URL-driven

```
/admin/dashboard                 → window=30d (default)
/admin/dashboard?window=7d       → 7-day view
/admin/accounts?window=ytd&sort=-mrr&filter[plan]=pro → bookmarkable
```

Rationale: admin bookmarks a "past-due Pro clubs this quarter" view, shares it, back button works. Shared module state would silently clobber on nav.

### 5.3 Field-rename handling (§2.1 of live doc)

The server renames `bookings_30d → bookings_7d` etc. based on `?window`. In templates, read as `row[`bookings_${window}`]`. TypeScript is kept strict by the template-literal index signatures on `AdminAccountRow` in `admin.ts`.

Build a tiny helper:
```ts
export function windowedField<K extends 'bookings' | 'bookings_gmv' | /* ... */>(
  row: AdminAccountRow,
  key: K,
  window: AdminWindow
): number { /* ... */ }
```
Centralises the suffix convention; if the server ever changes the pattern, one place to update.

### 5.4 Loading / error conventions

- First load: skeleton rows (reuse `Skeleton` from `@torny/content-blocks`), not spinner.
- Window change / filter change: keep stale data visible, overlay a subtle loading bar.
- Error: inline error strip at the top of the list/panel with retry button. Don't take the whole view down.
- Empty: `AdminEmptyState` with context-specific copy ("No past-due accounts in the window" ≠ "No data").

---

## 6. Role gating + auth

### 6.1 Router guard

Add to the existing admin route group (or create one if the admin routes aren't already grouped):

```ts
{
  path: '/admin',
  component: AdminShell,
  beforeEnter: (to, from, next) => {
    const auth = useAuthStore()
    if (!auth.user?.is_platform_admin) {
      useToast().error('Not authorised')
      return next({ name: 'crm-home' })
    }
    next()
  },
  children: [ /* dashboard, accounts, etc. */ ],
}
```

### 6.2 Field naming

- Backend `/me` response: `is_platform_admin` (existing column, per live doc §7.3)
- Backend admin endpoint responses: `is_platform_owner` for consistency with the original brief naming
- FE treats the two as synonyms (per live doc note). Document in `authStore.user.ts` type alias so the drift isn't surprising.

### 6.3 403 handling

If a Phase 1 admin endpoint returns `403 not_platform_owner` mid-session (e.g. admin flag was revoked in a different tab), the global error handler should route to `/crm` with a toast. Add to the existing `ApiError` handler — don't duplicate the check per-view.

---

## 7. Phases

### Phase A — Shell + Dashboard + Accounts list (MVP)

Scope:
1. Delete claims + platform-members files and routes (§2)
2. Update admin sidebar nav to the four-item list
3. `AdminDashboardView.vue` consuming `metricsOverview`
4. `AdminAccountsView.vue` consuming `listAccounts` — table + filters + sort + search + load-more
5. Shared primitives: `AdminWindowToggle`, `AdminMetricCard`, `AdminMoney`, `AdminFlagBadges`, `AdminEmptyState`
6. `useAdminWindow`, `useAdminAccounts`, `useAdminMetrics` composables
7. Router guard on `/admin/*`
8. Smoke test (Playwright) that an admin user can land on `/admin/dashboard`, see numbers, navigate to Accounts, filter + sort

**Estimate: 2–3 days.**

### Phase B — Account detail + Billing view

Scope:
1. `AdminAccountDetailView.vue` with Overview tab (Transactions + Communications tabs stubbed with "coming soon")
2. `AdminAccountOverviewTab.vue` — row metrics + `AdminTimelineList` + disabled `AdminActionBar`
3. `AdminBillingView.vue` consuming `metricsBilling` — subscription MRR + transactional split by kind + failed-payments panel (shows zero-state in Phase 1)
4. `useAdminAccount` composable
5. Extend smoke to click into an account + load billing view

**Estimate: 1–2 days.**

### Phase C — Users stub + cleanup pass

Scope:
1. `AdminUsersView.vue` renders `AdminEmptyState` with "Platform user management lands in the next ship — here's what it'll show" copy
2. Audit: ensure no dead imports or code paths referencing claims / platform members remain
3. Remove `is_claim_admin` or similar deprecated auth flags if any exist
4. Update `docs/production-readiness/README.md` index with the admin shell shipment

**Estimate: 0.5 days.**

### Phase D — Admin actions UI (blocked on backend Phase 2)

Scope (when backend Phase 2 ships §8 endpoints):
1. Wire `AdminActionBar` buttons to real endpoints
2. Impersonate flow: button → confirmation modal with "reason" input → endpoint → session hot-swap → redirect to `/crm` as the target user → persistent impersonation banner at the top of the CRM shell with "Return to admin" exit
3. Comp plan modal: plan picker + until-date + reason → endpoint → refresh account detail
4. Suspend modal: confirmation + reason + `notify_owner` checkbox → endpoint → flag flips in-place
5. `/admin/audit` page or drawer surfacing the audit log
6. Platform-user grant/revoke via `/admin/users` reshape

### Phase E — Transactions, Communications, System health (blocked on backend Phase 3)

Scope (when backend Phase 3 ships):
1. Account detail Transactions tab consuming `/admin/accounts/:id/transactions`
2. Account detail Communications tab consuming `/admin/accounts/:id/communications`
3. New `/admin/system` page consuming `/admin/system/health` — Sentry top-N, deploy heads, smoke gate status, SES quota

---

## 8. Open questions / decisions to make before Phase A starts

1. **Impersonate return path.** When admin leaves an impersonated session, where do they land? Options:
   (a) Back to `/admin/accounts/:id` (contextual)
   (b) Back to `/admin/dashboard` (safe default)
   My pick: (a). Need to stash the admin's original session state so return doesn't re-login.
2. **Dashboard refresh cadence.** Does the Dashboard poll for live numbers, or is it a static snapshot on nav? Vote: static for V1, add a manual refresh button. Polling adds complexity and admin isn't an operations dashboard.
3. **"Comped" plan display.** On the Accounts list, do we show `plan: 'comped'` as a distinct chip colour, or show the underlying `plan_actual` with a "COMP" badge? My pick: distinct chip ("COMPED PRO") so it's visually scannable in a list.
4. **Table density.** Default to comfortable rows (14px type) or compact (12px) — compact lets admins see ~25 rows per screen vs ~18. Vote: compact. Admin viewing hundreds of accounts benefits more than detail-view users.
5. **Where to put the window toggle on the Dashboard.** Top-right of the header, floating on scroll, or in-line per tile? Vote: top-right of the page header, applies to the whole page.

---

## 9. Non-goals

Carried from the live doc + explicit for this FE plan:

- **No new Pinia stores for admin.** Composables + URL state. If we ever need shared state between views beyond the window param, re-evaluate.
- **No sparkline charts in Phase A.** Backend returns empty arrays in Phase 1; render a placeholder `AdminMetricCard` without a chart area rather than fake data.
- **No infinite scroll on the Accounts table.** "Load more" button only. Keeps keyboard nav + Playwright testability clean; infinite scroll is a pain to test without a real backing dataset.
- **No multi-select / bulk actions.** V1 is single-account actions. Bulk suspend / bulk comp is a trap — too easy to blast-radius.
- **No cross-tab live sync.** If admin has two tabs open, actions in one don't propagate. Edge case; not worth the complexity.
- **No admin-facing dark mode.** CRM is light-mode throughout; don't invent a parallel palette for admin.
- **No in-app Sentry / error search beyond the top-N panel.** Deep-link to Sentry for the real investigation; don't rebuild Sentry's UI inside the CRM.
- **No CSV / Excel export.** Non-goal per the live doc §10. If someone needs numbers out, run SQL or use Stripe's export.

---

## 10. Verification checklist (Phase A exit criteria)

Before marking Phase A shipped:

- [ ] `/admin/claims*` and `/admin/members` return 404 in the CRM (routes removed)
- [ ] `/admin/dashboard` renders all overview metrics for the logged-in platform admin
- [ ] Window toggle on Dashboard writes `?window=` to the URL; back button restores previous window
- [ ] `/admin/accounts` lists Naenae + the three other clubs with correct MRR, member count, bookings 30d
- [ ] Sorting by `-mrr` puts the Pro club first
- [ ] Searching for `naenae` returns one row
- [ ] Filtering by `plan=pro` narrows to paying clubs only
- [ ] Non-platform-admin user hitting `/admin/*` is redirected to `/crm` with a toast
- [ ] Playwright smoke suite covers the above golden path
- [ ] Typecheck + unit tests + CRM E2E suite all green
- [ ] No console errors on any admin page under Playwright's strict gate
- [ ] `ApiError` handler routes `403 not_platform_owner` mid-session back to `/crm`

---

## 11. Rough file layout (for reviewer orientation)

```
apps/crm/src/
  views/admin/
    AdminDashboardView.vue          Phase A — new
    AdminAccountsView.vue           Phase A — renamed from AdminClubsView, rewritten
    AdminAccountDetailView.vue      Phase B — new
    AdminBillingView.vue            Phase B — new
    AdminUsersView.vue              Phase C — stub; Phase D — reshape
    AdminClaimsView.vue             DELETE
    AdminClaimDetailView.vue        DELETE
    AdminMembersView.vue            DELETE
  components/admin/
    AdminShell.vue                  existing — prune nav
    AdminSidebar.vue                existing — prune nav
    AdminWindowToggle.vue           Phase A — new
    AdminMetricCard.vue             Phase A — new
    AdminMoney.vue                  Phase A — new (or add formatCents util)
    AdminFlagBadges.vue             Phase A — new
    AdminEmptyState.vue             Phase A — new
    AdminAccountsTable.vue          Phase A — new
    AdminAccountsFilters.vue        Phase A — new
    AdminDashboardTiles.vue         Phase A — new
    AdminBillingSummary.vue         Phase B — new
    AdminTimelineList.vue           Phase B — new
    AdminAccountOverviewTab.vue     Phase B — new
    AdminActionBar.vue              Phase B — new, disabled; Phase D — wired
  composables/
    useAdminWindow.ts               Phase A — new
    useAdminAccounts.ts             Phase A — new
    useAdminMetrics.ts              Phase A — new
    useAdminAccount.ts              Phase B — new
  router/index.ts                   Phase A — update routes + guard
  stores/claims.ts                  DELETE
packages/api-client/src/resources/claims.ts   DELETE
```

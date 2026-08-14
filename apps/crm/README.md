# @torny/crm

Club owner CRM. Vue 3 + Vite SPA.

## Dev

```bash
pnpm --filter @torny/crm dev
# → http://localhost:5174
```

Set `VITE_API_BASE_URL` in `.env.local` to point at the Torny API.

## Structure

```
src/
├── layouts/       CrmShell (sidebar+topbar) and AuthShell
├── router/        Vue Router config + auth/role guards
├── stores/        Pinia — auth, club (current club context)
├── composables/   useApi (typed api client), useCurrentClub
├── views/         One folder per section (dashboard, members, events, …)
└── styles/        Base CSS, imports tokens.css from @torny/design-tokens
```

Role gate: `/crm/*` (all routes at the moment) require `role in [owner, admin]`.

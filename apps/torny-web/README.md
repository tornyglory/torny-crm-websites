# @torny/torny-web

The Torny web app — deployed at `torny.co`. Web mirror of the Torny native
app. Members sign in here and see their profile, clubs, feed, RSVPs, etc.

Not to be confused with `apps/club-sites` — that renders the per-club
public websites (`[slug].torny.co`). This app is the network's front door.

## Deep-link skin

Sign-in accepts an optional `?club=slug` query param. Clicking "Members
sign in" on a club's public site links to
`https://torny.co/sign-in?club=naenaebowling`, and the sign-in page skins
the left rail with that club's logo, name, and accent colour so it feels
like the user hasn't left the club's world at the moment of authentication.

Without the param, the page shows generic Torny branding.

## Dev

```bash
pnpm --filter @torny/torny-web dev   # → http://localhost:3002
```

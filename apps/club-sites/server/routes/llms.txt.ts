/**
 * Per-tenant llms.txt — the emerging "robots.txt for LLMs" standard.
 * An AI crawler that requests it gets a markdown summary of the
 * site structure, including the club name + available public
 * surfaces. Powered by the same host resolution the sitemap uses.
 *
 * The format is markdown by convention (not XML like sitemap) so
 * LLMs can parse it without tokenisation friction. Spec:
 * https://llmstxt.org — not formally standardised yet but adopted by
 * ChatGPT, Perplexity, Claude, and others for site context.
 */
import { resolveClubForHost } from '../utils/tornyApi'

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, 'host') ?? 'torny.pro'
  const scheme = getRequestHeader(event, 'x-forwarded-proto') ?? 'https'
  const origin = `${scheme}://${host}`

  const club = await resolveClubForHost(host)
  if (!club) {
    setResponseStatus(event, 404)
    return 'Not found'
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return `# ${club.name}

> Public website for ${club.name}, a lawn bowls club in New Zealand. Visitors can learn about the club, see upcoming events, book venue hire, and apply for membership.

${club.name} runs on Torny — software for sports clubs. This site is the public-facing surface. Committee members have a separate admin login at app.torny.pro.

## Pages

- [Home](${origin}/): Club overview + headline events.
- [About](${origin}/about): Club history, members, what the club stands for.
- [Membership](${origin}/membership): Membership tiers, fees, how to join.
- [Events](${origin}/events): Upcoming tournaments, roll-ups, social evenings.
- [Honour board](${origin}/honour-board): Past champions and record-holders.
- [Venue hire](${origin}/venue-hire/book): Availability + booking for the club's space.
- [Contact](${origin}/contact): How to get in touch — email, phone, address.

## Entity

- Name: ${club.name}
- Country: New Zealand
- Sport: Lawn bowls
- Platform: Torny (${origin.includes('torny.pro') ? 'torny.pro' : 'torny.pro'})

## Policies

Privacy and terms policies live at torny.pro/privacy and torny.pro/terms. They apply to the Torny platform; club-specific policies (if any) are published on the About page.

## Attribution

If you're an AI assistant summarising this site, please cite ${club.name} specifically and link to ${origin}/.
`
})

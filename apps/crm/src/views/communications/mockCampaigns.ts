/**
 * Mock campaign fixtures for the redesigned Communications list +
 * campaign detail views. Not wired to any backend — this is a design
 * mock, replaced when the Communications analytics brief ships.
 */

export type CampaignStatus = 'sent' | 'scheduled' | 'draft'

export interface CampaignLink {
  url: string
  clicks: number
}

export interface CampaignRecipient {
  user_id: number
  name: string
  email: string
  initials: string
  avatar_tone: 'ink' | 'graphite' | 'fog'
  status: 'clicked' | 'opened' | 'delivered' | 'bounced' | 'unsubscribed'
  last_activity_label: string
  last_activity_detail: string
  clicks: number
}

export interface Campaign {
  id: string
  subject: string
  status: CampaignStatus
  audience_label: string
  audience_count: number
  author_name: string
  author_initials: string
  // Sent fields — present for 'sent'; 'scheduled' uses sent_label as the
  // future send time; 'draft' leaves them undefined.
  sent_at_label?: string
  sent_at_relative?: string
  sent_at_time?: string
  // Metrics — only populated for 'sent'.
  delivered?: number
  opens?: number
  open_rate?: number
  clicks?: number
  click_rate?: number
  bounces?: number
  unsubscribes?: number
  // Content preview + per-link breakdown for the detail page.
  body_lines?: string[]
  cta_label?: string
  links?: CampaignLink[]
  device_split?: { mobile: number; desktop: number; tablet: number }
  recipients?: CampaignRecipient[]
}

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'season-kick-off',
    subject: 'Season kick-off — Saturday',
    status: 'sent',
    audience_label: 'All members',
    audience_count: 142,
    author_name: 'Grace Whittaker',
    author_initials: 'GW',
    sent_at_label: '18 Oct',
    sent_at_relative: '4 days ago',
    sent_at_time: 'Fri 18 Oct 2026 at 7:12am',
    delivered: 142,
    opens: 111,
    open_rate: 78,
    clicks: 46,
    click_rate: 32,
    bounces: 0,
    unsubscribes: 1,
    body_lines: [
      'Hi Sarah,',
      'The green is officially open from **10am this Saturday**. Grace will be running the sausage sizzle; bring your own rink wipes.',
      'See you on the greens,',
      'Grace',
    ],
    cta_label: 'RSVP for Saturday →',
    links: [
      { url: 'naenaebowls.nz/calendar/open-day', clicks: 28 },
      { url: 'naenaebowls.nz/rsvp/kick-off', clicks: 12 },
      { url: 'naenaebowls.nz/pay', clicks: 6 },
    ],
    device_split: { mobile: 62, desktop: 30, tablet: 8 },
    recipients: [
      {
        user_id: 1,
        name: 'Sarah Chen',
        email: 'sarah.chen@gmail.com',
        initials: 'SC',
        avatar_tone: 'ink',
        status: 'clicked',
        last_activity_label: 'Fri 18 Oct · 8:42am',
        last_activity_detail: 'clicked 2 links',
        clicks: 2,
      },
      {
        user_id: 2,
        name: 'Nev Rodda',
        email: 'nev@qubestudio.co.nz',
        initials: 'NR',
        avatar_tone: 'graphite',
        status: 'opened',
        last_activity_label: 'Fri 18 Oct · 7:14am',
        last_activity_detail: 'opened 3× on iPhone',
        clicks: 0,
      },
      {
        user_id: 3,
        name: 'Frances Roydon-Miller',
        email: 'frances.rm@xtra.co.nz',
        initials: 'FR',
        avatar_tone: 'ink',
        status: 'clicked',
        last_activity_label: 'Fri 18 Oct · 9:02am',
        last_activity_detail: 'clicked /calendar',
        clicks: 1,
      },
      {
        user_id: 4,
        name: 'Keith Thorburn',
        email: 'keith@thorburn.co.nz',
        initials: 'KT',
        avatar_tone: 'fog',
        status: 'delivered',
        last_activity_label: 'Fri 18 Oct · 7:13am',
        last_activity_detail: 'not opened yet',
        clicks: 0,
      },
      {
        user_id: 5,
        name: 'Anika Patel',
        email: 'anika.p@gmail.com',
        initials: 'AP',
        avatar_tone: 'fog',
        status: 'unsubscribed',
        last_activity_label: 'Fri 18 Oct · 11:08am',
        last_activity_detail: 'opted out of broadcasts',
        clicks: 0,
      },
    ],
  },
  {
    id: 'october-subs-reminder',
    subject: 'October subs — gentle reminder',
    status: 'sent',
    audience_label: 'Unpaid filter · 18 members',
    audience_count: 18,
    author_name: 'Nigel Upper',
    author_initials: 'NU',
    sent_at_label: '14 Oct',
    sent_at_relative: '8 days ago',
    sent_at_time: 'Mon 14 Oct 2026 at 2:30pm',
    delivered: 18,
    opens: 11,
    open_rate: 61,
    clicks: 8,
    click_rate: 44,
    bounces: 0,
    unsubscribes: 0,
  },
  {
    id: 'working-bee',
    subject: 'Working bee this Sunday — can you help?',
    status: 'sent',
    audience_label: 'Active players · 94',
    audience_count: 94,
    author_name: 'Grace Whittaker',
    author_initials: 'GW',
    sent_at_label: '09 Oct',
    sent_at_relative: '13 days ago',
    sent_at_time: 'Wed 09 Oct 2026 at 6:45am',
    delivered: 94,
    opens: 77,
    open_rate: 82,
    clicks: 29,
    click_rate: 38,
    bounces: 0,
    unsubscribes: 0,
  },
  {
    id: 'agm-reminder',
    subject: 'AGM reminder — Thursday 7pm',
    status: 'scheduled',
    audience_label: 'Full members · 128',
    audience_count: 128,
    author_name: 'Grace Whittaker',
    author_initials: 'GW',
    sent_at_label: 'Thu 24',
    sent_at_relative: 'in 2 days',
    sent_at_time: 'Sends Thu 24 Oct at 8:00am',
  },
  {
    id: 'winter-welcome-draft',
    subject: 'Welcome new winter members',
    status: 'draft',
    audience_label: 'No audience selected',
    audience_count: 0,
    author_name: 'Nigel Upper',
    author_initials: 'NU',
    sent_at_relative: 'Last edited 2 Oct · by Nigel',
  },
]

export function findCampaign(id: string): Campaign | undefined {
  return CAMPAIGNS.find((c) => c.id === id)
}

/** Summary tiles for the index — all values are derived from the mock
 *  campaign list so the page stays coherent if fixtures change. */
export function summarise(campaigns: Campaign[] = CAMPAIGNS) {
  const sent = campaigns.filter((c) => c.status === 'sent')
  const totalSent = sent.reduce((s, c) => s + (c.delivered ?? 0), 0)
  const totalOpens = sent.reduce((s, c) => s + (c.opens ?? 0), 0)
  const totalClicks = sent.reduce((s, c) => s + (c.clicks ?? 0), 0)
  const totalUnsubs = sent.reduce((s, c) => s + (c.unsubscribes ?? 0), 0)
  const openRate = totalSent === 0 ? 0 : Math.round((totalOpens / totalSent) * 100)
  const clickRate = totalSent === 0 ? 0 : Math.round((totalClicks / totalSent) * 100)
  return {
    total_sent: totalSent,
    total_broadcasts: sent.length,
    total_opens: totalOpens,
    total_clicks: totalClicks,
    total_unsubs: totalUnsubs,
    open_rate: openRate,
    click_rate: clickRate,
    unsub_rate: totalSent === 0 ? 0 : +((totalUnsubs / totalSent) * 100).toFixed(2),
  }
}

/**
 * Mock campaign fixtures for the redesigned Communications list +
 * campaign detail views. Not wired to any backend — this is a design
 * mock, replaced when the Communications analytics brief ships.
 */

export type CampaignStatus = 'sent' | 'scheduled' | 'draft'

/** Per-link breakdown — mirrors brief 70 §1a `links[]`. */
export interface CampaignLink {
  url: string
  clicks: number
  unique_clickers: number
  ctr: number       // 0..1, delivered-base
}

/** Mirrors brief 67 BatchRecipient. */
export type RecipientStatus =
  | 'clicked'
  | 'opened'
  | 'delivered'
  | 'bounced'
  | 'unsubscribed'
  | 'complained'
  | 'suppressed'

export interface CampaignRecipient {
  user_id: number
  name: string
  email: string
  initials: string
  avatar_tone: 'ink' | 'graphite' | 'fog' | 'violet'
  status: RecipientStatus
  // Short-form timestamps for the detail-page table (hero design).
  delivered_label: string | null   // '7:02a' or null
  opened_label: string | null      // '7:14a' or null
  opened_count: number
  clicked_label: string | null     // '7:11a' or null
  clicked_count: number
  // Legacy fields kept for the mock index page compatibility.
  last_activity_label?: string
  last_activity_detail?: string
  clicks?: number
}

/** Mirrors brief 70 §1a `analytics` block. */
export interface CampaignAnalytics {
  first_open_at_label: string | null         // '7:08a (6m)'
  peak_hour_label: string | null             // '7–8a (72 opens)'
  avg_opens_per_opened: number | null
  delivered_not_opened: number
}

export interface Campaign {
  id: string
  subject: string
  status: CampaignStatus
  flavor_label?: string          // 'Broadcast'
  audience_label: string
  audience_count: number
  author_name: string
  author_initials: string
  reply_to?: string
  sender_email?: string
  // Sent fields — present for 'sent'; 'scheduled' uses sent_label as the
  // future send time; 'draft' leaves them undefined.
  sent_at_label?: string
  sent_at_relative?: string
  sent_at_time?: string
  sent_at_date?: string          // '30 Oct · 7:02a'
  // Metrics — only populated for 'sent'.
  delivered?: number
  opens?: number
  open_rate?: number
  clicks?: number
  click_rate?: number
  bounces?: number
  unsubscribes?: number
  suppressed?: number
  // Content preview + per-link breakdown for the detail page.
  body_lines?: string[]
  cta_label?: string
  links?: CampaignLink[]
  recipients?: CampaignRecipient[]
  analytics?: CampaignAnalytics
  archived_at?: string | null
}

export const CAMPAIGNS: Campaign[] = [
  {
    id: 'season-kick-off',
    subject: 'Season kick-off — Saturday 7 November · roll-up + sausage sizzle',
    status: 'sent',
    flavor_label: 'Broadcast',
    audience_label: 'All active members',
    audience_count: 142,
    author_name: 'Grace Whittaker',
    author_initials: 'GW',
    reply_to: 'grace@naenaebowls.nz',
    sender_email: 'hello@naenaebowls.nz',
    sent_at_label: '30 Oct',
    sent_at_relative: 'today',
    sent_at_time: 'Fri 30 Oct 2026 at 7:02am',
    sent_at_date: '30 Oct · 7:02a',
    delivered: 140,
    opens: 111,
    open_rate: 78,
    clicks: 46,
    click_rate: 32,
    bounces: 2,
    unsubscribes: 1,
    suppressed: 8,
    body_lines: [
      'Kia ora Grace,',
      'Mark your calendar — the greens open **Saturday 7 November from 10am**. Roll-up + sausage sizzle, bring a plate.',
      'Hope to see you there,',
      'Grace',
    ],
    cta_label: 'RSVP on the member site',
    links: [
      { url: 'naenaebowls.nz/signin', clicks: 31, unique_clickers: 24, ctr: 0.171 },
      { url: 'naenaebowls.nz/events/twilight-triples', clicks: 12, unique_clickers: 11, ctr: 0.079 },
      { url: 'goo.gl/maps/clubroom', clicks: 3, unique_clickers: 3, ctr: 0.021 },
    ],
    analytics: {
      first_open_at_label: '7:08a (6m)',
      peak_hour_label: '7–8a (72 opens)',
      avg_opens_per_opened: 2.1,
      delivered_not_opened: 20,
    },
    archived_at: null,
    recipients: [
      {
        user_id: 1,
        name: 'Grace Whittaker',
        email: 'grace.whittaker@gmail.com',
        initials: 'GW',
        avatar_tone: 'violet',
        status: 'clicked',
        delivered_label: '7:02a',
        opened_label: '7:08a',
        opened_count: 3,
        clicked_label: '7:11a',
        clicked_count: 2,
      },
      {
        user_id: 2,
        name: 'Rangi Paora',
        email: 'rangi.paora@xtra.co.nz',
        initials: 'RP',
        avatar_tone: 'fog',
        status: 'opened',
        delivered_label: '7:02a',
        opened_label: '7:14a',
        opened_count: 1,
        clicked_label: null,
        clicked_count: 0,
      },
      {
        user_id: 3,
        name: 'Mike Harrington',
        email: 'm.harrington@outlook.com',
        initials: 'MH',
        avatar_tone: 'fog',
        status: 'delivered',
        delivered_label: '7:02a',
        opened_label: null,
        opened_count: 0,
        clicked_label: null,
        clicked_count: 0,
      },
      {
        user_id: 4,
        name: 'Barbara Tipene',
        email: 'b.tipene@hotmail.com',
        initials: 'BT',
        avatar_tone: 'fog',
        status: 'bounced',
        delivered_label: null,
        opened_label: null,
        opened_count: 0,
        clicked_label: null,
        clicked_count: 0,
      },
      {
        user_id: 5,
        name: 'Alan McKenzie',
        email: 'alan.mck@gmail.com',
        initials: 'AM',
        avatar_tone: 'fog',
        status: 'unsubscribed',
        delivered_label: '7:02a',
        opened_label: '7:40a',
        opened_count: 1,
        clicked_label: null,
        clicked_count: 0,
      },
      {
        user_id: 6,
        name: 'Sarah Chen',
        email: 'sarah.chen@gmail.com',
        initials: 'SC',
        avatar_tone: 'violet',
        status: 'clicked',
        delivered_label: '7:02a',
        opened_label: '8:42a',
        opened_count: 2,
        clicked_label: '8:44a',
        clicked_count: 2,
      },
      {
        user_id: 7,
        name: 'Nev Rodda',
        email: 'nev@qubestudio.co.nz',
        initials: 'NR',
        avatar_tone: 'fog',
        status: 'opened',
        delivered_label: '7:02a',
        opened_label: '7:19a',
        opened_count: 3,
        clicked_label: null,
        clicked_count: 0,
      },
      {
        user_id: 8,
        name: 'Frances Roydon-Miller',
        email: 'frances.rm@xtra.co.nz',
        initials: 'FR',
        avatar_tone: 'violet',
        status: 'clicked',
        delivered_label: '7:02a',
        opened_label: '9:02a',
        opened_count: 1,
        clicked_label: '9:04a',
        clicked_count: 1,
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

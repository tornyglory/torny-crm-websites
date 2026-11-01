/**
 * Template UI metadata + helpers.
 *
 * The backend (`emailTemplate.listFlavors(cid)`, brief 45 + 46) owns the
 * subject + body for every flavour. Everything in this file is CRM-only
 * copy — labels, descriptions, icon tones, slug↔flavor conversion.
 */
import type { EmailFlavor } from '@torny/api-client'

export type TemplateCategory = 'broadcast' | 'transactional'
export type IconTone = 'ink' | 'violet'

export interface FlavorMeta {
  label: string
  description: string
  category: TemplateCategory
  categoryLabel: 'Broadcast' | 'Transactional'
  iconTone: IconTone
}

export const FLAVOR_META: Record<EmailFlavor, FlavorMeta> = {
  broadcast: {
    label: 'Broadcast',
    description: "The composer's default send.",
    category: 'broadcast',
    categoryLabel: 'Broadcast',
    iconTone: 'ink',
  },
  member_welcome: {
    label: 'Member welcome',
    description: 'Fires when an admin adds a paying member.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
  application_received: {
    label: 'Application received',
    description: 'Auto-reply when someone applies to join.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
  application_approved: {
    label: 'Application approved',
    description: 'Fires when an admin approves an application.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
  application_rejected: {
    label: 'Application declined',
    description: 'Fires when an admin declines an application.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
  enquiry_received: {
    label: 'Enquiry received',
    description: 'Auto-reply when someone sends an enquiry.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
  enquiry_reply: {
    label: 'Enquiry reply',
    description: 'Fires on an admin replying to an enquiry.',
    category: 'transactional',
    categoryLabel: 'Transactional',
    iconTone: 'violet',
  },
}

/** The 7 flavour keys in the same order the UI should render them. */
export const FLAVOR_ORDER: EmailFlavor[] = [
  'broadcast',
  'member_welcome',
  'application_received',
  'application_approved',
  'application_rejected',
  'enquiry_received',
  'enquiry_reply',
]

/** URL slug uses dashes; backend uses underscores. */
export function flavorToSlug(flavor: EmailFlavor): string {
  return flavor.replace(/_/g, '-')
}

export function slugToFlavor(slug: string): EmailFlavor | null {
  const normalised = slug.replace(/-/g, '_') as EmailFlavor
  return normalised in FLAVOR_META ? normalised : null
}

const SHORT_DATE = new Intl.DateTimeFormat('en-NZ', { day: '2-digit', month: 'short' })
const DAY = 1000 * 60 * 60 * 24
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const label = SHORT_DATE.format(d)
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / DAY))
  if (diff === 0) return `${label} · today`
  if (diff === 1) return `${label} · yesterday`
  if (diff < 7) return `${label} · ${diff}d ago`
  if (diff < 30) return `${label} · ${Math.floor(diff / 7)}w ago`
  return label
}

/** Strip simple HTML to plain text with `\n\n` paragraph breaks and `- `
 *  bullet markers. Good enough for the backend's platform-default copy
 *  which uses only `<p>` + `<ul><li>`. More exotic HTML falls through as
 *  raw text — admins can still edit, the backend validates on save. */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<li>\s*/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/ul>|<\/ol>/gi, '\n')
    .replace(/<ul[^>]*>|<ol[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Wrap plain-text paragraphs in `<p>`; group consecutive `- ` lines into
 *  `<ul>`. Matches the shape `htmlToPlain()` understands so round-tripping
 *  is stable. */
export function plainToHtml(plain: string): string {
  const paragraphs = plain.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const para of paragraphs) {
    const lines = para.split(/\n/)
    const bullets: string[] = []
    const rest: string[] = []
    let listMode = false
    for (const line of lines) {
      if (line.startsWith('- ')) {
        if (!listMode && rest.length > 0) {
          out.push(`<p>${rest.join('<br>')}</p>`)
          rest.length = 0
        }
        bullets.push(line.slice(2))
        listMode = true
      } else {
        if (listMode && bullets.length > 0) {
          out.push(`<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`)
          bullets.length = 0
        }
        rest.push(line)
        listMode = false
      }
    }
    if (bullets.length > 0) {
      out.push(`<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`)
    }
    if (rest.length > 0) {
      out.push(`<p>${rest.join('<br>')}</p>`)
    }
  }
  return out.join('')
}

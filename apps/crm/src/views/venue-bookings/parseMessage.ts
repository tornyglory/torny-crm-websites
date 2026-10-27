/**
 * Parse the structured plaintext a VenueBookingBlock submits into
 * `club_enquiries.message` for topic='facilities'. The emitter is
 * `VenueBookingBlock.vue → buildMessage()`; keep the two in sync.
 *
 * The emitter format (as of 2026-10):
 *
 *   <occasion> · <guest_count> guests
 *   <package_name> · <slot_label>
 *   <date_label>
 *   Setup: <setup_style>
 *   [Add-ons:
 *   • <addon_name> [× <qty>]
 *   • …]
 *   [Notes: <notes…>]
 *   [Booking on behalf of: <name>]
 *   Total: $<total> · Deposit: $<deposit> · Balance: $<balance>
 *
 * All fields other than the first four + totals line are optional. The
 * notes block can span multiple lines until we hit the next labelled
 * field. If any part fails to parse, callers should fall back to
 * rendering the raw string.
 */

export interface ParsedAddon {
  name: string
  quantity: number | null
}

export interface ParsedVenueBooking {
  occasion: string | null
  guest_count: number | null
  package: string | null
  slot: string | null
  date_label: string | null
  setup: string | null
  addons: ParsedAddon[]
  notes: string | null
  booking_for: string | null
  total: number | null
  deposit: number | null
  balance: number | null
  /** True when the first + totals lines matched. If false, treat parse as failed. */
  ok: boolean
}

const EMPTY: ParsedVenueBooking = {
  occasion: null,
  guest_count: null,
  package: null,
  slot: null,
  date_label: null,
  setup: null,
  addons: [],
  notes: null,
  booking_for: null,
  total: null,
  deposit: null,
  balance: null,
  ok: false,
}

/** `$1,930` → 1930. Strips `$` and commas; returns null on NaN. */
function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** `40 guests` → 40. */
function parseGuests(raw: string): number | null {
  const m = raw.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function parseVenueBookingMessage(message: string | null | undefined): ParsedVenueBooking {
  if (!message) return EMPTY
  const lines = message.split('\n')
  const out: ParsedVenueBooking = { ...EMPTY, addons: [] }

  // Line 0 — `<occasion> · <N> guests`.
  const first = lines[0]?.trim() ?? ''
  if (first) {
    const [occ, rest] = first.split('·').map((s) => s.trim())
    out.occasion = occ || null
    if (rest) out.guest_count = parseGuests(rest)
  }

  // Line 1 — `<package> · <slot>`. Slot can itself contain `·` separators
  // (e.g. "Afternoon · 2pm – 6pm"), so split on the FIRST `·` only.
  const second = lines[1]?.trim() ?? ''
  if (second) {
    const idx = second.indexOf('·')
    if (idx > -1) {
      out.package = second.slice(0, idx).trim() || null
      out.slot = second.slice(idx + 1).trim() || null
    } else {
      out.package = second || null
    }
  }

  // Line 2 — date label. Walk forward until we hit a labelled line, in
  // case the user's date label was blank (shouldn't happen but defend).
  let i = 2
  if (i < lines.length) {
    const t = lines[i]!.trim()
    if (t && !/^(Setup:|Add-ons:|Notes:|Booking on behalf of:|Total:)/.test(t)) {
      out.date_label = t
      i += 1
    }
  }

  // Walk remaining lines by label. Notes may span multiple lines.
  let inAddons = false
  let notesBuf: string[] = []
  let inNotes = false

  function flushNotes() {
    if (notesBuf.length) {
      out.notes = notesBuf.join('\n').trim() || null
      notesBuf = []
    }
    inNotes = false
  }

  for (; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = raw.trim()
    if (!line) {
      if (inNotes) notesBuf.push('')
      continue
    }
    if (line.startsWith('Setup:')) {
      flushNotes()
      inAddons = false
      out.setup = line.slice('Setup:'.length).trim() || null
      continue
    }
    if (line === 'Add-ons:') {
      flushNotes()
      inAddons = true
      continue
    }
    if (inAddons && line.startsWith('•')) {
      const body = line.slice(1).trim()
      const qtyMatch = body.match(/^(.*?)\s+×\s+(\d+)\s*$/)
      if (qtyMatch) {
        out.addons.push({ name: qtyMatch[1]!.trim(), quantity: Number(qtyMatch[2]) })
      } else {
        out.addons.push({ name: body, quantity: null })
      }
      continue
    }
    inAddons = false
    if (line.startsWith('Notes:')) {
      flushNotes()
      inNotes = true
      const first = line.slice('Notes:'.length).trim()
      if (first) notesBuf.push(first)
      continue
    }
    if (line.startsWith('Booking on behalf of:')) {
      flushNotes()
      out.booking_for = line.slice('Booking on behalf of:'.length).trim() || null
      continue
    }
    if (line.startsWith('Total:')) {
      flushNotes()
      // `Total: $X · Deposit: $Y · Balance: $Z`
      const body = line.slice('Total:'.length).trim()
      const parts = body.split('·').map((s) => s.trim())
      for (const p of parts) {
        if (p.startsWith('Deposit:')) out.deposit = parseMoney(p.slice('Deposit:'.length).trim())
        else if (p.startsWith('Balance:')) out.balance = parseMoney(p.slice('Balance:'.length).trim())
        else out.total = parseMoney(p)
      }
      continue
    }
    if (inNotes) {
      notesBuf.push(raw)
    }
  }
  flushNotes()

  out.ok = !!(out.occasion || out.package) && out.total != null
  return out
}

/** Fallback-safe display helpers used by both list + detail views. */
export function formatMoney(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null
  return `$${n.toLocaleString()}`
}

/**
 * Lock down the parser + serializer that back the Venue bookings view.
 *
 * The emitter is `VenueBookingBlock.vue → buildMessage()`. These tests
 * are the compat seal between the two — if the FE writer ever changes
 * its format and these fail, update both in lockstep.
 *
 * Row 12's actual message (from `club_enquiries` on 2026-10-26) is the
 * anchor case. Other tests cover every optional branch so a benign
 * cosmetic edit (e.g. the FE dropping the Setup line) can't silently
 * degrade the list/detail cards.
 */
import { describe, it, expect } from 'vitest'
import {
  parseVenueBookingMessage,
  serializeVenueBookingMessage,
  formatMoney,
  type ParsedVenueBooking,
} from './parseMessage'

/** The real row-12 message as persisted by VenueBookingBlock. Don't
 *  edit this — it's the regression anchor. */
const ROW_12 = `Birthday · 40 guests
The clubhouse · Afternoon · 2pm – 6pm
Friday 13 November
Setup: Long tables + bar
Add-ons:
• Grazing platters × 9
Notes: Yes, we have a bunch of people that are vegetarian.
Booking on behalf of: Douglas Rodda
Total: $1765 · Deposit: $441 · Balance: $1324`

describe('parseVenueBookingMessage — row 12 (the real one)', () => {
  const p = parseVenueBookingMessage(ROW_12)

  it('flags the parse as ok', () => {
    expect(p.ok).toBe(true)
  })

  it('pulls occasion + guest count out of the first line', () => {
    expect(p.occasion).toBe('Birthday')
    expect(p.guest_count).toBe(40)
  })

  it('splits package from slot on the first middot only', () => {
    expect(p.package).toBe('The clubhouse')
    expect(p.slot).toBe('Afternoon · 2pm – 6pm')
  })

  it('reads the date label verbatim', () => {
    expect(p.date_label).toBe('Friday 13 November')
  })

  it('captures setup from the labelled line', () => {
    expect(p.setup).toBe('Long tables + bar')
  })

  it('parses add-ons with × quantities', () => {
    expect(p.addons).toEqual([{ name: 'Grazing platters', quantity: 9 }])
  })

  it('pulls notes without the Notes: prefix', () => {
    expect(p.notes).toBe('Yes, we have a bunch of people that are vegetarian.')
  })

  it('extracts booking_for from the labelled line', () => {
    expect(p.booking_for).toBe('Douglas Rodda')
  })

  it('splits total · deposit · balance from the money line', () => {
    expect(p.total).toBe(1765)
    expect(p.deposit).toBe(441)
    expect(p.balance).toBe(1324)
  })
})

describe('parseVenueBookingMessage — optional sections', () => {
  it('handles messages without add-ons / notes / booking_for', () => {
    const msg = `Wedding · 120 guests
Whole shebang · Full day · 9am – 11pm
Sat 15 Nov
Setup: Round tables
Total: $4850 · Deposit: $1213 · Balance: $3637`
    const p = parseVenueBookingMessage(msg)
    expect(p.ok).toBe(true)
    expect(p.addons).toEqual([])
    expect(p.notes).toBeNull()
    expect(p.booking_for).toBeNull()
    expect(p.total).toBe(4850)
  })

  it('captures multi-line notes until the next labelled field', () => {
    const msg = `Birthday · 20 guests
Green + BBQ · Weekend afternoon · 2pm – 6pm
Sun 2 Nov
Setup: Casual
Notes: Mum is in a wheelchair.
We need the ramp open.
Please no music before 5pm.
Booking on behalf of: Mel
Total: $300 · Deposit: $75 · Balance: $225`
    const p = parseVenueBookingMessage(msg)
    expect(p.notes).toBe(
      'Mum is in a wheelchair.\nWe need the ramp open.\nPlease no music before 5pm.',
    )
    expect(p.booking_for).toBe('Mel')
  })

  it('reads add-ons without × quantities as quantity: null', () => {
    const msg = `Corporate · 50 guests
The clubhouse · Evening · 6pm – 11pm
Thu 20 Nov
Setup: Boardroom
Add-ons:
• BBQ pack
• Coach for the hour × 2
Total: $1200 · Deposit: $300 · Balance: $900`
    const p = parseVenueBookingMessage(msg)
    expect(p.addons).toEqual([
      { name: 'BBQ pack', quantity: null },
      { name: 'Coach for the hour', quantity: 2 },
    ])
  })

  it('preserves slot lines that contain multiple middots', () => {
    const msg = `Birthday · 40 guests
The clubhouse · Weekend afternoon · 2pm – 6pm · $720
Sat 15 Nov
Setup: Long tables
Total: $720`
    const p = parseVenueBookingMessage(msg)
    expect(p.package).toBe('The clubhouse')
    expect(p.slot).toBe('Weekend afternoon · 2pm – 6pm · $720')
    expect(p.total).toBe(720)
    expect(p.deposit).toBeNull()
    expect(p.balance).toBeNull()
  })

  it('handles the "1 guest" edge', () => {
    const msg = `Private · 1 guest
The clubhouse · Morning · 9am – 1pm
Mon 10 Nov
Setup: Minimal
Total: $720`
    const p = parseVenueBookingMessage(msg)
    expect(p.guest_count).toBe(1)
  })
})

describe('parseVenueBookingMessage — hostile input', () => {
  it('returns ok: false for empty string', () => {
    const p = parseVenueBookingMessage('')
    expect(p.ok).toBe(false)
  })

  it('returns ok: false for null', () => {
    const p = parseVenueBookingMessage(null)
    expect(p.ok).toBe(false)
  })

  it('returns ok: false for undefined', () => {
    const p = parseVenueBookingMessage(undefined)
    expect(p.ok).toBe(false)
  })

  it('does not throw on freeform junk', () => {
    const p = parseVenueBookingMessage(
      'Hey this is not a booking at all, just some random text.',
    )
    expect(p.ok).toBe(false)
  })
})

/** The round-trip is the strongest guarantee we can offer admins: if
 *  they open Edit, change nothing, and Save, the stored message is
 *  byte-identical. Property-style test over every representative shape. */
describe('serializeVenueBookingMessage — round-trip stability', () => {
  const samples = [
    { name: 'row 12', msg: ROW_12 },
    {
      name: 'no optional sections',
      msg: `Wedding · 120 guests
Whole shebang · Full day · 9am – 11pm
Sat 15 Nov
Setup: Round tables
Total: $4850 · Deposit: $1213 · Balance: $3637`,
    },
    {
      name: 'multi-line notes + booking_for',
      msg: `Birthday · 20 guests
Green + BBQ · Weekend afternoon · 2pm – 6pm
Sun 2 Nov
Setup: Casual
Notes: Mum is in a wheelchair.
We need the ramp open.
Booking on behalf of: Mel
Total: $300 · Deposit: $75 · Balance: $225`,
    },
    {
      name: 'add-ons with and without qty',
      msg: `Corporate · 50 guests
The clubhouse · Evening · 6pm – 11pm
Thu 20 Nov
Setup: Boardroom
Add-ons:
• BBQ pack
• Coach for the hour × 2
Total: $1200 · Deposit: $300 · Balance: $900`,
    },
  ]

  for (const s of samples) {
    it(`${s.name} is byte-identical after parse → serialize`, () => {
      const parsed = parseVenueBookingMessage(s.msg)
      const back = serializeVenueBookingMessage(toForm(parsed))
      expect(back).toBe(s.msg)
    })

    it(`${s.name} is parse-stable after parse → serialize → parse`, () => {
      const parsed = parseVenueBookingMessage(s.msg)
      const back = serializeVenueBookingMessage(toForm(parsed))
      const reparsed = parseVenueBookingMessage(back)
      expect(reparsed).toEqual(parsed)
    })
  }

  it('drops notes when the user clears them to empty', () => {
    const parsed = parseVenueBookingMessage(ROW_12)
    const form = toForm(parsed)
    form.notes = ''
    const back = serializeVenueBookingMessage(form)
    expect(back).not.toContain('Notes:')
    const reparsed = parseVenueBookingMessage(back)
    expect(reparsed.notes).toBeNull()
  })

  it('drops add-ons section when the list is empty', () => {
    const parsed = parseVenueBookingMessage(ROW_12)
    const form = toForm(parsed)
    form.addons = []
    const back = serializeVenueBookingMessage(form)
    expect(back).not.toContain('Add-ons:')
    const reparsed = parseVenueBookingMessage(back)
    expect(reparsed.addons).toEqual([])
  })
})

describe('formatMoney', () => {
  it('formats positive integers', () => {
    expect(formatMoney(1930)).toBe('$1,930')
  })

  it('returns null for null / undefined / NaN', () => {
    expect(formatMoney(null)).toBeNull()
    expect(formatMoney(undefined)).toBeNull()
    expect(formatMoney(Number.NaN)).toBeNull()
  })

  it('handles zero as a real amount, not null', () => {
    expect(formatMoney(0)).toBe('$0')
  })
})

/** Shrink the parsed shape (which has nullable strings) to the
 *  serializer input shape (which demands strings). Mirrors what the
 *  detail view does when it hydrates the edit modal. */
function toForm(p: ParsedVenueBooking) {
  return {
    occasion: p.occasion ?? '',
    guest_count: p.guest_count,
    package: p.package ?? '',
    slot: p.slot ?? '',
    date_label: p.date_label ?? '',
    setup: p.setup ?? '',
    addons: p.addons,
    notes: p.notes ?? '',
    booking_for: p.booking_for ?? '',
    total: p.total,
    deposit: p.deposit,
    balance: p.balance,
  }
}

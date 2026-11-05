/**
 * Unit tests for the api-client `teamSelections` wrapper. Locks the
 * URL + method + body contract against brief 74 so the backend can
 * implement to a fixed shape and future FE refactors can't drift.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  teamSelections,
  type CreateTeamSelectionInput,
  type PublishInput,
  type UpdateRosterInput,
} from '@torny/api-client'

const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CLUB_ID = 5
const SELECTION_ID = 12

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  localStorage.setItem('torny.token', 'test-token')
})
afterEach(() => {
  localStorage.setItem('torny.token', 'test-token')
})

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const SELECTION_FIXTURE = {
  id: SELECTION_ID,
  club_id: CLUB_ID,
  competition: 'Pennant Div 3',
  round_label: 'Round 8',
  opponent: 'Petone A',
  venue: 'home' as const,
  starts_at: '2026-08-23T00:30:00Z',
  format_label: 'Fours × 2',
  event_id: null,
  manager_note: null,
  green_closure_note: null,
  status: 'draft' as const,
  sent_at: null,
  played_at: null,
  cancelled_at: null,
  cancelled_reason: null,
  confirmed_count: 4,
  total_slots: 8,
  rinks: [],
  created_at: '2026-08-18T10:00:00Z',
  updated_at: '2026-08-20T14:12:00Z',
}

describe('teamSelections.list', () => {
  it('GETs scope + include_drafts + pagination as a querystring', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selections: [], count: 0, total: 0 }))
    await teamSelections.list(CLUB_ID, {
      scope: 'upcoming',
      include_drafts: false,
      limit: 25,
      offset: 50,
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      `${CRM_BASE}/clubs/${CLUB_ID}/team-selections?scope=upcoming&include_drafts=false&limit=25&offset=50`,
    )
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('omits the querystring entirely when no params are passed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selections: [], count: 0, total: 0 }))
    await teamSelections.list(CLUB_ID)
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections`)
  })
})

describe('teamSelections.get', () => {
  it('GETs detail and unwraps the { selection } envelope', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    const res = await teamSelections.get(CLUB_ID, SELECTION_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}`)
    expect(init.method).toBe('GET')
    // The resource strips the nested envelope so callers see a flat
    // Selection object.
    expect(res.id).toBe(SELECTION_ID)
    expect(res.competition).toBe('Pennant Div 3')
  })
})

describe('teamSelections.create', () => {
  it('POSTs the create input body verbatim', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    const input: CreateTeamSelectionInput = {
      competition: 'Pennant Div 3',
      round_label: 'Round 8',
      opponent: 'Petone A',
      venue: 'home',
      starts_at: '2026-08-23T00:30:00Z',
      format_label: 'Fours × 2',
      format_shape: { positions: ['Lead', 'Second', 'Third', 'Skip'], rink_count: 2 },
      event_id: null,
      manager_note: null,
      green_closure_note: null,
    }
    await teamSelections.create(CLUB_ID, input)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(input)
  })

  it('appends ?force=1 when the admin overrides the past-date guard', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    await teamSelections.create(
      CLUB_ID,
      {
        competition: 'Pennant Div 3',
        round_label: 'Round 8',
        opponent: 'Petone A',
        venue: 'home',
        starts_at: '2020-01-01T00:00:00Z',  // in the past
        format_label: 'Fours × 2',
        format_shape: { positions: ['Skip'], rink_count: 1 },
      },
      { force: true },
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections?force=1`)
  })
})

describe('teamSelections.update', () => {
  it('PATCHes a fixture-only body when `rinks` is absent', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    await teamSelections.update(CLUB_ID, SELECTION_ID, { manager_note: 'First bowl at 12:30 sharp.' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ manager_note: 'First bowl at 12:30 sharp.' })
    expect(body.rinks).toBeUndefined()
  })

  it('PATCHes the whole roster shape when `rinks` is present', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    const roster: UpdateRosterInput = {
      rinks: [
        {
          id: 34,
          label: 'Rink 1',
          position: 0,
          slots: [
            { id: 101, member_id: 2 },
            { id: 102, member_id: 5 },
            { id: 103, member_id: 3 },
            { id: 104, member_id: 1 },
          ],
        },
        // Brand-new rink — id omitted so backend inserts.
        {
          label: 'Rink 3',
          position: 2,
          slots: [{ position: 'Skip', slot_order: 3, member_id: null }],
        },
      ],
    }
    await teamSelections.update(CLUB_ID, SELECTION_ID, roster)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.rinks).toHaveLength(2)
    // Slot with an explicit id → UPDATE.
    expect(body.rinks[0].slots[0]).toEqual({ id: 101, member_id: 2 })
    // Rink without an id → INSERT.
    expect(body.rinks[1].id).toBeUndefined()
  })

  it('appends ?allow_duplicate=1 when the admin opts to double-book a player', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: SELECTION_FIXTURE }))
    await teamSelections.update(
      CLUB_ID,
      SELECTION_ID,
      { rinks: [{ id: 34, slots: [{ id: 101, member_id: 2 }] }] },
      { allowDuplicate: true },
    )
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}?allow_duplicate=1`)
  })
})

describe('teamSelections.remove', () => {
  it('DELETEs the selection endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await teamSelections.remove(CLUB_ID, SELECTION_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}`)
    expect(init.method).toBe('DELETE')
  })
})

describe('teamSelections.publish', () => {
  it('POSTs /publish with an optional manager message', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        selection: { ...SELECTION_FIXTURE, status: 'sent', sent_at: '2026-08-21T10:00:00Z' },
        notify_summary: { picked: 8, dropped: 0, already_notified: 0 },
      }),
    )
    const input: PublishInput = { message: 'Weather looks perfect.' }
    const res = await teamSelections.publish(CLUB_ID, SELECTION_ID, input)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}/publish`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(input)
    expect(res.selection.status).toBe('sent')
    expect(res.notify_summary).toEqual({ picked: 8, dropped: 0, already_notified: 0 })
  })

  it('sends an empty object body when no message is passed', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        selection: { ...SELECTION_FIXTURE, status: 'sent' },
        notify_summary: { picked: 0, dropped: 0, already_notified: 8 },
      }),
    )
    await teamSelections.publish(CLUB_ID, SELECTION_ID)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body).toEqual({})
  })
})

describe('teamSelections.reopen / cancel / markPlayed', () => {
  it('POSTs /reopen with an empty body', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: { ...SELECTION_FIXTURE, status: 'confirmed' } }))
    await teamSelections.reopen(CLUB_ID, SELECTION_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}/reopen`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
  })

  it('POSTs /cancel with the required reason', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        selection: { ...SELECTION_FIXTURE, status: 'cancelled', cancelled_reason: 'Waterlogged green.' },
        notify_summary: { picked: 0, dropped: 8, already_notified: 0 },
      }),
    )
    await teamSelections.cancel(CLUB_ID, SELECTION_ID, { reason: 'Waterlogged green.' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}/cancel`)
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Waterlogged green.' })
  })

  it('POSTs /mark-played with an empty body', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selection: { ...SELECTION_FIXTURE, status: 'played' } }))
    await teamSelections.markPlayed(CLUB_ID, SELECTION_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/clubs/${CLUB_ID}/team-selections/${SELECTION_ID}/mark-played`)
    expect(init.body).toBe('{}')
  })
})

describe('teamSelections.listPublic / getPublic / withdrawUrl', () => {
  it('GETs the public list without auth header', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ selections: [] }))
    await teamSelections.listPublic('naenae')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CRM_BASE}/public/clubs/naenae/team-selections`)
    const headers = init.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBeUndefined()
  })

  it('builds a signed withdraw URL that round-trips through encodeURIComponent', async () => {
    const url = teamSelections.withdrawUrl('abc.def/ghi+jkl')
    expect(url).toBe(`${CRM_BASE}/public/team-selections/withdraw?token=abc.def%2Fghi%2Bjkl`)
  })
})

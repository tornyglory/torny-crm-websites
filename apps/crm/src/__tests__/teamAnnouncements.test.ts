/**
 * Unit tests for the api-client `teamAnnouncements` wrapper.
 *
 * Shape is the contract — these tests lock in URL + method + body so a
 * future refactor can't silently drift from the sport-flexibility
 * brief. Running them does NOT hit the real backend; global fetch is
 * stubbed per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { teamAnnouncements, ApiError, type CreateTeamAnnouncementInput } from '@torny/api-client'

const VENUE_BASE = 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CLUB_ID = 5
const SLUG = 'nae-nae-bowling-club'

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
    status: 200, headers: { 'content-type': 'application/json' },
  })
}
function errorResponse(status: number, code: string, message?: string) {
  return new Response(JSON.stringify({ status: 'error', code, message: message ?? code }), {
    status, headers: { 'content-type': 'application/json' },
  })
}

const ANNOUNCEMENT_FIXTURE = {
  id: 1, club_id: CLUB_ID, sport_id: null,
  name: 'Open Mixed 500m — Festival Entry',
  division: 'Open Mixed 500m', location: 'Lake Rotorua',
  event_at: '2027-02-05T07:30:00Z',
  notes: 'Call time 06:00 at the beach.',
  status: 'draft' as const, published_at: null,
  created_by_user_id: 1111,
  created_at: '2026-11-05T00:00:00Z',
  updated_at: '2026-11-05T00:00:00Z',
  members: [
    { id: 11, user_id: 42, name: 'Alice',    role: 'Drummer',    is_reserve: false, sort_order: 10 },
    { id: 12, user_id: 43, name: 'Bob',      role: 'Steerer',    is_reserve: false, sort_order: 20 },
    { id: 13, user_id: null, name: 'Alt A',  role: null,         is_reserve: true,  sort_order: 30 },
  ],
}

describe('teamAnnouncements.list', () => {
  it('GETs the list endpoint + forwards status filter', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({
      announcements: [{ ...ANNOUNCEMENT_FIXTURE, member_count: 3 }],
      counts: { draft: 1, published: 0, cancelled: 0 },
    }))
    await teamAnnouncements.list(CLUB_ID, { status: 'published' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements?status=published`)
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('omits status query param when not set', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({
      announcements: [], counts: { draft: 0, published: 0, cancelled: 0 },
    }))
    await teamAnnouncements.list(CLUB_ID)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements`)
  })
})

describe('teamAnnouncements.create', () => {
  it('POSTs the create input to the admin collection', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(ANNOUNCEMENT_FIXTURE))
    const input: CreateTeamAnnouncementInput = {
      name: 'Open Mixed 500m — Festival Entry',
      division: 'Open Mixed 500m',
      location: 'Lake Rotorua',
      event_at: '2027-02-05T07:30:00Z',
      notes: 'Call time 06:00 at the beach.',
      members: [
        { user_id: 42, name: 'Alice', role: 'Drummer' },
        { user_id: null, name: 'Alt A', is_reserve: true },
      ],
    }
    const result = await teamAnnouncements.create(CLUB_ID, input)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(input)
    expect(result.members).toHaveLength(3)
  })
})

describe('teamAnnouncements.update', () => {
  it('PATCHes the detail endpoint with the diff shape', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(ANNOUNCEMENT_FIXTURE))
    await teamAnnouncements.update(CLUB_ID, 1, {
      notes: 'Updated call time 06:30.',
      members: [
        // id present → UPDATE
        { id: 11, user_id: 42, name: 'Alice', role: 'Lead Drummer', is_reserve: false },
        // id absent → INSERT
        { user_id: null, name: 'New guest', role: 'Paddler', is_reserve: false },
      ],
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements/1`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.notes).toBe('Updated call time 06:30.')
    expect(body.members).toHaveLength(2)
    expect(body.members[0].id).toBe(11)
    expect(body.members[1].id).toBeUndefined()
  })
})

describe('teamAnnouncements.publish', () => {
  it('POSTs an empty body to /publish', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({
      ...ANNOUNCEMENT_FIXTURE,
      status: 'published',
      published_at: '2026-11-05T12:00:00Z',
    }))
    const res = await teamAnnouncements.publish(CLUB_ID, 1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements/1/publish`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(res.status).toBe('published')
  })
})

describe('teamAnnouncements.remove', () => {
  it('DELETEs the detail endpoint', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null))
    await teamAnnouncements.remove(CLUB_ID, 1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/team-announcements/1`)
    expect(init.method).toBe('DELETE')
  })
})

describe('teamAnnouncements.listPublic', () => {
  it('GETs the public endpoint without auth header', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ announcements: [ANNOUNCEMENT_FIXTURE] }))
    await teamAnnouncements.listPublic(SLUG)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/public/clubs/${SLUG}/team-announcements`)
    expect(init.method).toBe('GET')
    // Public reads don't carry Authorization — publicFetch skips it.
    const headers = init.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBeUndefined()
  })
})

describe('teamAnnouncements — error surface', () => {
  it('surfaces 400 bad_member_name as an ApiError with the code', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, 'bad_member_name', 'Member name is required.'))
    await expect(
      teamAnnouncements.create(CLUB_ID, {
        name: 'x',
        members: [{ user_id: null, name: '' }],
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      body: expect.objectContaining({ code: 'bad_member_name' }),
    })
  })

  it('surfaces 403 forbidden when caller lacks admin role', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'forbidden'))
    await expect(teamAnnouncements.publish(CLUB_ID, 1)).rejects.toBeInstanceOf(ApiError)
  })
})

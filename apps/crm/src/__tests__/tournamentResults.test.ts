/**
 * Unit tests for the api-client `tournamentResults` wrapper. Locks in
 * the URL + body contract so a future refactor can't drift from the
 * sport-flexibility brief Layer 3 shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tournamentResults, type SubmitResultsInput } from '@torny/api-client'

const VENUE_BASE = 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CLUB_ID = 5
const TOURNAMENT_ID = 24

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

const RESULTS_FIXTURE = {
  tournament_id: TOURNAMENT_ID,
  tournament_status: 'complete',
  entries: [
    {
      entry_id: 7001, entry_number: 1,
      team_name: 'Team Willis',
      captain_user_id: 2, captain_email: 'ruth@example.co.nz', captain_phone: null,
      entry_status: 'confirmed' as const,
      result: {
        id: 1001, position: 1, placement_label: 'Champion',
        prize_money_cents: 75000, won: true,
        notes: 'Best skip all day.',
        recorded_at: '2026-11-05T00:00:00Z',
        recorded_by_user_id: 1111,
        updated_at: '2026-11-05T00:00:00Z',
      },
    },
    {
      entry_id: 7002, entry_number: 2,
      team_name: 'Team Smith',
      captain_user_id: 3, captain_email: 'peter@example.co.nz', captain_phone: null,
      entry_status: 'confirmed' as const,
      result: null,  // unplaced — editor shows "No result yet"
    },
  ],
}

describe('tournamentResults.get', () => {
  it('GETs the admin results endpoint', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RESULTS_FIXTURE))
    const res = await tournamentResults.get(CLUB_ID, TOURNAMENT_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/tournaments/${TOURNAMENT_ID}/results`)
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
    expect(res.entries).toHaveLength(2)
    expect(res.entries[1]!.result).toBeNull()
  })
})

describe('tournamentResults.submit', () => {
  it('POSTs the batch upsert with mark_complete when set', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RESULTS_FIXTURE))
    const input: SubmitResultsInput = {
      results: [
        { entry_id: 7001, position: 1, placement_label: 'Champion', prize_money_cents: 75000, won: true },
        { entry_id: 7002, position: 2, placement_label: 'Runner-up', prize_money_cents: 25000, won: true },
      ],
      mark_complete: true,
    }
    await tournamentResults.submit(CLUB_ID, TOURNAMENT_ID, input)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/tournaments/${TOURNAMENT_ID}/results`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual(input)
    expect(body.mark_complete).toBe(true)
  })

  it('omits mark_complete when the admin only saves partial results', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RESULTS_FIXTURE))
    await tournamentResults.submit(CLUB_ID, TOURNAMENT_ID, {
      results: [{ entry_id: 7001, notes: 'Mid-session save.' }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.mark_complete).toBeUndefined()
    expect(body.results).toHaveLength(1)
  })
})

describe('tournamentResults.getPublic', () => {
  it('GETs the public leaderboard without auth', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RESULTS_FIXTURE))
    await tournamentResults.getPublic(TOURNAMENT_ID)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/public/tournaments/${TOURNAMENT_ID}/results`)
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBeUndefined()
  })
})

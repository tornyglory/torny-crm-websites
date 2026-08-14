import { defineEventHandler, readBody, createError } from 'h3'
import { tornyFetch } from '../utils/tornyApi'

interface ApplicationBody {
  firstName: string
  lastName: string
  email: string
  phone?: string
  membershipTypeId?: string
  notes?: string
}

// Public membership form → CRM applications inbox.
export default defineEventHandler(async (event) => {
  const club = event.context.club as { id: string } | undefined
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const body = await readBody<ApplicationBody>(event)
  if (!body?.firstName || !body?.lastName || !body?.email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing fields' })
  }

  await tornyFetch('/applications', {
    method: 'POST',
    headers: { 'X-Torny-Club': club.id },
    body: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      membershipTypeId: body.membershipTypeId,
      notes: body.notes,
      source: 'website_form',
    },
  })

  return { ok: true }
})

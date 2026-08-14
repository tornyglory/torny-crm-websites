import { defineEventHandler, readBody, createError } from 'h3'
import { tornyFetch } from '../utils/tornyApi'

interface ContactBody {
  name: string
  email: string
  message: string
}

// Public contact form → CRM enquiries inbox.
export default defineEventHandler(async (event) => {
  const club = event.context.club as { id: string } | undefined
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const body = await readBody<ContactBody>(event)
  if (!body?.name || !body?.email || !body?.message) {
    throw createError({ statusCode: 400, statusMessage: 'Missing fields' })
  }

  await tornyFetch('/enquiries', {
    method: 'POST',
    headers: { 'X-Torny-Club': club.id },
    body: {
      name: body.name,
      email: body.email,
      message: body.message,
      source: 'contact_form',
    },
  })

  return { ok: true }
})

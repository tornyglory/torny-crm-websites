import type { TornyClient } from '../client'
import type { Event, ID } from '../types'

export const list = (c: TornyClient, params?: { upcoming?: boolean; q?: string }) =>
  c.get<Event[]>('/events', { params }).then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<Event>(`/events/${id}`).then(r => r.data)

export const create = (c: TornyClient, body: Partial<Event>) =>
  c.post<Event>('/events', body).then(r => r.data)

export const update = (c: TornyClient, id: ID, body: Partial<Event>) =>
  c.patch<Event>(`/events/${id}`, body).then(r => r.data)

import type { TornyClient } from '../client'
import type { TeamSelection, ID } from '../types'

export const listForEvent = (c: TornyClient, eventId: ID) =>
  c.get<TeamSelection[]>(`/events/${eventId}/team-selections`).then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<TeamSelection>(`/team-selections/${id}`).then(r => r.data)

export const save = (c: TornyClient, id: ID, body: Partial<TeamSelection>) =>
  c.put<TeamSelection>(`/team-selections/${id}`, body).then(r => r.data)

export const publish = (c: TornyClient, id: ID) =>
  c.post<TeamSelection>(`/team-selections/${id}/publish`).then(r => r.data)

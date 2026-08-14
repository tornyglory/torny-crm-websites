import type { TornyClient } from '../client'
import type { Club, ID } from '../types'

export const listMine = (c: TornyClient) =>
  c.get<Club[]>('/clubs/mine').then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<Club>(`/clubs/${id}`).then(r => r.data)

export const update = (c: TornyClient, id: ID, body: Partial<Club>) =>
  c.patch<Club>(`/clubs/${id}`, body).then(r => r.data)

export const resolveByHost = (c: TornyClient, host: string) =>
  c.get<Club>('/clubs/resolve', { params: { host } }).then(r => r.data)

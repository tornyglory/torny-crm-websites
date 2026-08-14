import type { TornyClient } from '../client'
import type { Member, ID } from '../types'

export const list = (c: TornyClient, params?: { status?: string; q?: string }) =>
  c.get<Member[]>('/members', { params }).then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<Member>(`/members/${id}`).then(r => r.data)

export const create = (c: TornyClient, body: Partial<Member>) =>
  c.post<Member>('/members', body).then(r => r.data)

export const update = (c: TornyClient, id: ID, body: Partial<Member>) =>
  c.patch<Member>(`/members/${id}`, body).then(r => r.data)

export const remove = (c: TornyClient, id: ID) =>
  c.delete<void>(`/members/${id}`).then(r => r.data)

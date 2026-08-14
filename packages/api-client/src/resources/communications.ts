import type { TornyClient } from '../client'
import type { CommunicationDraft, ID } from '../types'

export const send = (c: TornyClient, body: CommunicationDraft) =>
  c.post<{ id: ID; queued: number }>('/communications', body).then(r => r.data)

export const history = (c: TornyClient) =>
  c.get<Array<{ id: ID; subject: string; sentAt: string; audienceSize: number }>>('/communications').then(r => r.data)

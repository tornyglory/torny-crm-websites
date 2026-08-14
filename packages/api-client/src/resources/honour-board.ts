import type { TornyClient } from '../client'
import type { HonourBoardCategory, HonourBoardEntry, ID } from '../types'

export const listCategories = (c: TornyClient) =>
  c.get<HonourBoardCategory[]>('/honour-board/categories').then(r => r.data)

export const listEntries = (c: TornyClient, categoryId: ID) =>
  c.get<HonourBoardEntry[]>(`/honour-board/categories/${categoryId}/entries`).then(r => r.data)

export const createEntry = (c: TornyClient, categoryId: ID, body: Partial<HonourBoardEntry>) =>
  c.post<HonourBoardEntry>(`/honour-board/categories/${categoryId}/entries`, body).then(r => r.data)

export const updateEntry = (c: TornyClient, id: ID, body: Partial<HonourBoardEntry>) =>
  c.patch<HonourBoardEntry>(`/honour-board/entries/${id}`, body).then(r => r.data)

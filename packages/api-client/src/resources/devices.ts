import type { TornyClient } from '../client'
import type { Device, ID } from '../types'

export const register = (
  c: TornyClient,
  body: { platform: Device['platform']; token: string; appVersion?: string },
) => c.post<Device>('/devices', body).then(r => r.data)

export const unregister = (c: TornyClient, id: ID) =>
  c.delete<void>(`/devices/${id}`).then(r => r.data)

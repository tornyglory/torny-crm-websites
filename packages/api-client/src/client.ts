import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'

export interface TornyClientOptions {
  baseURL: string
  getAuthToken?: () => string | null | Promise<string | null>
  getClubId?: () => string | null
}

export type TornyClient = AxiosInstance

export function createTornyClient(opts: TornyClientOptions): TornyClient {
  const instance = axios.create({
    baseURL: opts.baseURL,
    headers: { 'Content-Type': 'application/json' },
  })

  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (opts.getAuthToken) {
      const token = await opts.getAuthToken()
      if (token) config.headers.set('Authorization', `Bearer ${token}`)
    }
    if (opts.getClubId) {
      const clubId = opts.getClubId()
      if (clubId) config.headers.set('X-Torny-Club', clubId)
    }
    return config
  })

  return instance
}

import { clearToken, getToken, setToken } from '../auth'

const API_BASE = import.meta.env.VITE_API_URL || ''

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function formatDetail(detail) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || item.message || String(item)).join(', ')
  }
  return null
}

async function parseError(res) {
  try {
    const body = await res.json()
    return (
      formatDetail(body.detail) ||
      body.message ||
      body.error ||
      res.statusText
    )
  } catch {
    return res.statusText
  }
}

let isRefreshing = false
let refreshQueue = []

function onRefreshDone(token, err) {
  refreshQueue.forEach((cb) => cb(token, err))
  refreshQueue = []
}

async function tryRefresh() {
  const token = getToken()
  if (!token) throw new Error('No token')
  const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new ApiError('Refresh failed', res.status)
  const data = await res.json()
  if (!data?.access_token) throw new Error('No token in refresh response')
  setToken(data.access_token)
  return data.access_token
}

export async function request(path, options = {}) {
  const { skipAuth, skipRefresh, ...fetchOptions } = options
  const headers = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  }

  if (!skipAuth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  }).catch(() => {
    throw new ApiError('Network error — could not reach the API.', 0)
  })

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    // Try token refresh once
    if (!isRefreshing) {
      isRefreshing = true
      try {
        const newToken = await tryRefresh()
        isRefreshing = false
        onRefreshDone(newToken, null)
      } catch (err) {
        isRefreshing = false
        onRefreshDone(null, err)
        clearToken()
        window.location.href = '/login'
        throw new ApiError('Session expired. Please log in again.', 401)
      }
    } else {
      // Wait for the in-flight refresh
      await new Promise((resolve, reject) => {
        refreshQueue.push((token, err) => (err ? reject(err) : resolve(token)))
      })
    }
    // Retry original request with new token
    return request(path, { ...options, skipRefresh: true })
  }

  if (res.status === 401 && !skipAuth && skipRefresh) {
    clearToken()
    window.location.href = '/login'
    throw new ApiError('Session expired. Please log in again.', 401)
  }

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status)
  }

  if (res.status === 204) return null

  return res.json()
}

export function signup(email, password, organization_name, name) {
  return request('/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, organization_name, ...(name ? { name } : {}) }),
    skipAuth: true,
  })
}

export function login(email, password) {
  return request('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  })
}

export function logout() {
  return request('/v1/auth/logout', { method: 'POST' }).catch(() => null)
}

export function getMe() {
  return request('/v1/auth/me')
}

export function listApiKeys() {
  return request('/v1/api-keys')
}

export function createApiKey(name, scopes) {
  return request('/v1/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name, ...(scopes ? { scopes } : {}) }),
  })
}

export function rotateApiKey(keyId) {
  return request(`/v1/api-keys/${keyId}/rotate`, { method: 'POST' })
}

export function revokeApiKey(keyId) {
  return request(`/v1/api-keys/${keyId}`, { method: 'DELETE' })
}

export function normalizeKeyList(data) {
  if (Array.isArray(data)) return data
  if (data?.items) return data.items
  if (data?.api_keys) return data.api_keys
  if (data?.data) return data.data
  return []
}

export function listPublishableKeys() {
  return request('/v1/publishable-keys')
}

export function createPublishableKey(name, allowedOrigins) {
  return request('/v1/publishable-keys', {
    method: 'POST',
    body: JSON.stringify({ name, allowed_origins: allowedOrigins }),
  })
}

export function revokePublishableKey(keyId) {
  return request(`/v1/publishable-keys/${keyId}`, { method: 'DELETE' })
}

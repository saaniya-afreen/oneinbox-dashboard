import { clearToken, getToken } from '../auth'

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

export async function request(path, options = {}) {
  const { skipAuth, ...fetchOptions } = options
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
  })

  if (res.status === 401 && !skipAuth) {
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

export function createApiKey(name) {
  return request('/v1/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
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

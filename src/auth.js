const TOKEN_KEY = 'oneinbox_jwt'
const TOKEN_KEY_ALT = 'access_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_KEY_ALT, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY_ALT)
}

export function isAuthenticated() {
  return Boolean(getToken())
}

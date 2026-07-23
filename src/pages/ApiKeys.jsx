import { useCallback, useEffect, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  createApiKey,
  getActiveApiKey,
  getMe,
  listApiKeys,
  logout,
  normalizeKeyList,
  revokeApiKey,
  rotateApiKey,
  setActiveApiKey,
} from '../api/client'
import { clearToken } from '../auth'

function formatDate(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return value
  }
}

function maskKey(key) {
  const prefix = key.key_prefix || 'oi_sk_'
  return `${prefix}${'•'.repeat(28)}`
}

function IconKey() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

function IconEye({ open }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconCopy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconRotate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

function KeyRow({ keyData, fullKey, onRevokeClick, onRotateClick, revoking, rotating }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayValue = revealed && fullKey ? fullKey : maskKey(keyData)

  async function handleCopy() {
    if (!fullKey) return
    await navigator.clipboard.writeText(fullKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="key-row">
      <div className="key-row-meta">
        <div className="key-row-icon">
          <IconKey />
        </div>
        <div>
          <div className="key-row-name">
            {keyData.name || 'API Key'}
            {keyData.scopes && keyData.scopes.length > 0 && (
              <span className="key-row-scopes">{keyData.scopes.join(', ')}</span>
            )}
          </div>
          <div className="key-row-date">
            Created {formatDate(keyData.created_at)}
            {keyData.last_used_at && (
              <span> &middot; Last used {formatDate(keyData.last_used_at)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="key-row-value">
        <input readOnly value={displayValue} className="key-input" />
        <div className="key-row-actions">
          <button
            type="button"
            className="icon-btn"
            title={fullKey ? (revealed ? 'Hide' : 'Reveal') : 'Full key only shown at creation'}
            onClick={() => fullKey && setRevealed((v) => !v)}
            disabled={!fullKey}
          >
            <IconEye open={revealed} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={!fullKey ? 'Full key only available at creation — create a new key' : copied ? 'Copied!' : 'Copy'}
            onClick={handleCopy}
            disabled={!fullKey}
          >
            <IconCopy />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Rotate"
            onClick={() => onRotateClick(keyData)}
            disabled={rotating}
          >
            <IconRotate />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            title="Revoke"
            onClick={() => onRevokeClick(keyData)}
            disabled={revoking}
          >
            <IconTrash />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ApiKeys() {
  const navigate = useNavigate()
  const [keys, setKeys] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revokingId, setRevokingId] = useState(null)
  const [rotatingId, setRotatingId] = useState(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)

  const [revealedKey, setRevealedKey] = useState(null)
  const [copied, setCopied] = useState(false)
  const [keyToRevoke, setKeyToRevoke] = useState(null)
  const [keyToRotate, setKeyToRotate] = useState(null)
  const [sessionKeys, setSessionKeys] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('oneinbox_full_keys') || '{}')
    } catch {
      return {}
    }
  })

  const saveSessionKey = useCallback((id, apiKey) => {
    setSessionKeys((prev) => {
      const next = { ...prev, [id]: apiKey }
      localStorage.setItem('oneinbox_full_keys', JSON.stringify(next))
      return next
    })
  }, [])

  const removeSessionKey = useCallback((id) => {
    setSessionKeys((prev) => {
      const next = { ...prev }
      delete next[id]
      localStorage.setItem('oneinbox_full_keys', JSON.stringify(next))
      return next
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [keysData, meData] = await Promise.all([
        listApiKeys(),
        getMe().catch(() => null),
      ])
      const all = normalizeKeyList(keysData)
      const active = all.filter((k) => k.is_active !== false)
      setKeys(active)
      setUser(meData)
      // Auto-set active key for Billing page if not already set
      if (!getActiveApiKey()) {
        const stored = (() => {
          try { return JSON.parse(localStorage.getItem('oneinbox_full_keys') || '{}') } catch { return {} }
        })()
        const match = active.find((k) => stored[k.id])
        if (match) setActiveApiKey(stored[match.id])
      }
    } catch (err) {
      setError(err.message || 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleLogout() {
    await logout()
    clearToken()
    navigate('/login', { replace: true })
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newKeyName.trim()) return

    setCreating(true)
    setError('')

    try {
      const created = await createApiKey(newKeyName.trim())
      if (created?.id && created?.api_key) {
        saveSessionKey(created.id, created.api_key)
        setActiveApiKey(created.api_key)
      }
      setShowCreate(false)
      setNewKeyName('')
      setRevealedKey(created)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function confirmRevoke() {
    if (!keyToRevoke) return

    setError('')
    setRevokingId(keyToRevoke.id)
    try {
      await revokeApiKey(keyToRevoke.id)
      setKeys((prev) => prev.filter((k) => k.id !== keyToRevoke.id))
      removeSessionKey(keyToRevoke.id)
      setKeyToRevoke(null)
    } catch (err) {
      setError(err.message || 'Failed to revoke API key')
      await load()
    } finally {
      setRevokingId(null)
    }
  }

  async function confirmRotate() {
    if (!keyToRotate) return

    setError('')
    setRotatingId(keyToRotate.id)
    try {
      const rotated = await rotateApiKey(keyToRotate.id)
      // Store the new key value — it is the full api_key or nested under api_key
      const newKeyValue = rotated?.api_key || rotated?.key
      if (keyToRotate.id && newKeyValue) {
        saveSessionKey(keyToRotate.id, newKeyValue)
        setActiveApiKey(newKeyValue)
      }
      setKeyToRotate(null)
      setRevealedKey({ ...keyToRotate, api_key: newKeyValue })
      await load()
    } catch (err) {
      setError(err.message || 'Failed to rotate API key')
    } finally {
      setRotatingId(null)
    }
  }

  async function copyKey() {
    if (!revealedKey?.api_key) return
    await navigator.clipboard.writeText(revealedKey.api_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="page">
      <header className="header">
        <img src="/logo.svg" alt="OneInbox" className="logo-sm" />
        <div className="header-actions">
          {user?.email && <span className="muted">{user.email}</span>}
          <button type="button" className="btn ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="main">
        <nav className="top-nav">
          <NavLink to="/api-keys" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            API Keys
          </NavLink>
          <NavLink to="/calls" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            Call Logs
          </NavLink>
          <NavLink to="/activity" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            Activity
          </NavLink>
          <NavLink to="/billing" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            Billing
          </NavLink>
        </nav>

        <nav className="breadcrumb">
          <span>Settings</span>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">API key</span>
        </nav>

        <h1 className="page-title">API Keys</h1>

        <div className="keys-tabs">
          <NavLink to="/api-keys" className={({ isActive }) => 'keys-tab' + (isActive ? ' keys-tab-active' : '')}>
            Secret Keys
          </NavLink>
          <NavLink to="/publishable-keys" className={({ isActive }) => 'keys-tab' + (isActive ? ' keys-tab-active' : '')}>
            Publishable Keys
          </NavLink>
        </div>

        {error && <p className="error banner">{error}</p>}

        <section className="keys-card">
          <div className="keys-card-header">
            <div className="keys-card-heading">
              <div className="keys-card-icon keys-card-icon-private">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <h2>API Keys</h2>
                <p>Server-side API access</p>
              </div>
            </div>
            <button
              type="button"
              className="btn add-key"
              onClick={() => setShowCreate(true)}
            >
              + Add Key
            </button>
          </div>

          {loading ? (
            <p className="keys-empty muted">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="keys-empty muted">No active API keys.</p>
          ) : (
            <div className="keys-list">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  keyData={key}
                  fullKey={sessionKeys[key.id]}
                  onRevokeClick={setKeyToRevoke}
                  onRotateClick={setKeyToRotate}
                  revoking={revokingId === key.id}
                  rotating={rotatingId === key.id}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {showCreate && (
        <div className="overlay" onClick={() => setShowCreate(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Create API key</h2>
            <p className="muted">Give your key a name to identify it later.</p>
            <form onSubmit={handleCreate}>
              <label>
                Name
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Production"
                  required
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn add-key" disabled={creating}>
                  {creating ? 'Creating…' : '+ Add Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {keyToRevoke && (
        <div className="overlay" onClick={() => setKeyToRevoke(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Revoke API key?</h2>
            <p className="muted">
              <strong>{keyToRevoke.name || 'API Key'}</strong> will stop working
              immediately. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setKeyToRevoke(null)}
                disabled={revokingId === keyToRevoke.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={confirmRevoke}
                disabled={revokingId === keyToRevoke.id}
              >
                {revokingId === keyToRevoke.id ? 'Revoking…' : 'Revoke key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {keyToRotate && (
        <div className="overlay" onClick={() => setKeyToRotate(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Rotate API key?</h2>
            <p className="muted">
              <strong>{keyToRotate.name || 'API Key'}</strong> will be replaced
              with a new key. The old key will stop working immediately.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setKeyToRotate(null)}
                disabled={rotatingId === keyToRotate.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn add-key"
                onClick={confirmRotate}
                disabled={rotatingId === keyToRotate.id}
              >
                {rotatingId === keyToRotate.id ? 'Rotating…' : 'Rotate key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealedKey && (
        <div className="overlay" onClick={() => setRevealedKey(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>API key {revealedKey._rotated ? 'rotated' : 'created'}</h2>
            <p className="warning">
              Copy this key now. You won&apos;t be able to see it again.
            </p>
            <div className="key-box">
              <code>{revealedKey.api_key}</code>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={copyKey}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                className="btn add-key"
                onClick={() => setRevealedKey(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  createPublishableKey,
  getMe,
  listPublishableKeys,
  logout,
  normalizeKeyList,
  revokePublishableKey,
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
  const prefix = key.key_prefix || 'oi_pk_'
  return `${prefix}${'•'.repeat(28)}`
}

function IconGlobe() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
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

function KeyRow({ keyData, fullKey, onRevokeClick, revoking }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayValue = revealed && fullKey ? fullKey : maskKey(keyData)

  async function handleCopy() {
    const text = fullKey || keyData.key_prefix || ''
    if (!text) return
    await navigator.clipboard.writeText(text)
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
          <div className="key-row-name">{keyData.name || 'Publishable Key'}</div>
          <div className="key-row-date">
            {formatDate(keyData.created_at)}
            {keyData.allowed_origins?.length > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#6366f1' }}>
                {keyData.allowed_origins.length} origin{keyData.allowed_origins.length !== 1 ? 's' : ''}
              </span>
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
            title={copied ? 'Copied' : 'Copy'}
            onClick={handleCopy}
          >
            <IconCopy />
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

export default function PublishableKeys() {
  const navigate = useNavigate()
  const [keys, setKeys] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revokingId, setRevokingId] = useState(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newOrigins, setNewOrigins] = useState('')
  const [creating, setCreating] = useState(false)

  const [revealedKey, setRevealedKey] = useState(null)
  const [copied, setCopied] = useState(false)
  const [keyToRevoke, setKeyToRevoke] = useState(null)
  const [sessionKeys, setSessionKeys] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('oneinbox_pub_keys') || '{}')
    } catch {
      return {}
    }
  })

  const saveSessionKey = useCallback((id, apiKey) => {
    setSessionKeys((prev) => {
      const next = { ...prev, [id]: apiKey }
      localStorage.setItem('oneinbox_pub_keys', JSON.stringify(next))
      return next
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [keysData, meData] = await Promise.all([
        listPublishableKeys(),
        getMe().catch(() => null),
      ])
      const all = normalizeKeyList(keysData)
      setKeys(all.filter((k) => k.is_active !== false))
      setUser(meData)
    } catch (err) {
      setError(err.message || 'Failed to load publishable keys')
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

    const allowedOrigins = newOrigins
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)

    try {
      const created = await createPublishableKey(newKeyName.trim(), allowedOrigins)
      if (created?.id && created?.key) {
        saveSessionKey(created.id, created.key)
      }
      setShowCreate(false)
      setNewKeyName('')
      setNewOrigins('')
      setRevealedKey(created)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to create publishable key')
    } finally {
      setCreating(false)
    }
  }

  async function confirmRevoke() {
    if (!keyToRevoke) return

    setError('')
    setRevokingId(keyToRevoke.id)
    try {
      await revokePublishableKey(keyToRevoke.id)
      setKeys((prev) => prev.filter((k) => k.id !== keyToRevoke.id))
      setSessionKeys((prev) => {
        const next = { ...prev }
        delete next[keyToRevoke.id]
        localStorage.setItem('oneinbox_pub_keys', JSON.stringify(next))
        return next
      })
      setKeyToRevoke(null)
    } catch (err) {
      setError(err.message || 'Failed to revoke publishable key')
      await load()
    } finally {
      setRevokingId(null)
    }
  }

  async function copyKey() {
    if (!revealedKey?.key) return
    await navigator.clipboard.writeText(revealedKey.key)
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
        </nav>

        <nav className="breadcrumb">
          <span>Settings</span>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">Publishable Keys</span>
        </nav>

        <h1 className="page-title">Publishable Keys</h1>

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
              <div className="keys-card-icon keys-card-icon-public">
                <IconGlobe />
              </div>
              <div>
                <h2>Publishable Keys</h2>
                <p>Safe for client-side use — browser &amp; mobile apps</p>
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
            <div className="keys-empty">
              <p className="muted">No publishable keys yet.</p>
              <p className="muted" style={{ fontSize: '0.8125rem' }}>
                Publishable keys are safe to embed in frontend code. Use them to start web calls without exposing your secret key.
              </p>
            </div>
          ) : (
            <div className="keys-list">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  keyData={key}
                  fullKey={sessionKeys[key.id]}
                  onRevokeClick={setKeyToRevoke}
                  revoking={revokingId === key.id}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {showCreate && (
        <div className="overlay" onClick={() => setShowCreate(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Create publishable key</h2>
            <p className="muted">Safe for browser and mobile apps. Restrict by origin for security.</p>
            <form onSubmit={handleCreate}>
              <label>
                Name
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="My Web App"
                  required
                  autoFocus
                />
              </label>
              <label>
                Allowed origins <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional, one per line)</span>
                <textarea
                  value={newOrigins}
                  onChange={(e) => setNewOrigins(e.target.value)}
                  placeholder={'https://yourapp.com\nhttps://staging.yourapp.com'}
                  rows={3}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: '0.375rem',
                    padding: '0.625rem 0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '10px',
                    fontSize: '0.9375rem',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
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
            <h2>Revoke publishable key?</h2>
            <p className="muted">
              <strong>{keyToRevoke.name || 'Publishable Key'}</strong> will stop working
              immediately. Any frontend using it will lose access.
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

      {revealedKey && (
        <div className="overlay" onClick={() => setRevealedKey(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Publishable key created</h2>
            <p className="warning">
              Copy this key now. You won&apos;t be able to see it again.
            </p>
            <div className="key-box">
              <code>{revealedKey.key}</code>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={copyKey}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button type="button" className="btn add-key" onClick={() => setRevealedKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

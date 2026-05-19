import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createApiKey,
  getMe,
  listApiKeys,
  logout,
  normalizeKeyList,
  revokeApiKey,
} from '../api/client'
import { clearToken } from '../auth'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function ApiKeys() {
  const navigate = useNavigate()
  const [keys, setKeys] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)

  const [revealedKey, setRevealedKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [keysData, meData] = await Promise.all([
        listApiKeys(),
        getMe().catch(() => null),
      ])
      setKeys(normalizeKeyList(keysData))
      setUser(meData)
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

  async function handleRevoke(key) {
    const label = key.name || key.id
    if (!window.confirm(`Revoke "${label}"? This cannot be undone.`)) return

    setError('')
    try {
      await revokeApiKey(key.id)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to revoke API key')
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
        <div className="page-header">
          <div>
            <h1>API Keys</h1>
            <p className="muted">
              Create and revoke keys for the OneInbox API. Use keys in{' '}
              <code>Authorization: Bearer &lt;api_key&gt;</code>.
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowCreate(true)}
          >
            Create API key
          </button>
        </div>

        {error && <p className="error banner">{error}</p>}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : keys.length === 0 ? (
          <div className="card empty">
            <p>No API keys yet.</p>
            <button
              type="button"
              className="btn primary"
              onClick={() => setShowCreate(true)}
            >
              Create your first key
            </button>
          </div>
        ) : (
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name || '—'}</td>
                    <td>
                      <code>{key.id}</code>
                    </td>
                    <td>{formatDate(key.created_at)}</td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() => handleRevoke(key)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {showCreate && (
        <div className="overlay" onClick={() => setShowCreate(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>Create API key</h2>
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
                <button type="submit" className="btn primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {revealedKey && (
        <div className="overlay" onClick={() => setRevealedKey(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>API key created</h2>
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
                className="btn primary"
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

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  clearActiveApiKey,
  getActiveApiKey,
  getActivitySummary,
  getMe,
  listAuditEvents,
  logout,
  normalizeAuditList,
  setActiveApiKey,
} from '../api/client'
import { clearToken } from '../auth'

const DATE_OPTIONS = [
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Today', value: '1d' },
]

function sinceParam(value) {
  const now = new Date()
  if (value === '1d') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return d.toISOString()
  }
  if (value === '7d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  return undefined
}

function formatDateTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return value }
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value ?? '—'}</div>
      <div className="stat-card-label">{label}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="activity-section-title">{children}</h2>
}

function AuditRow({ event }) {
  const actor = event.api_key_id
    ? `key · ${event.api_key_id.slice(0, 8)}`
    : event.user_id
    ? `user · ${event.user_id.slice(0, 8)}`
    : '—'

  return (
    <tr className="audit-row">
      <td className="audit-cell audit-cell-action">
        <code className="audit-action">{event.action || '—'}</code>
      </td>
      <td className="audit-cell">{event.resource_type || '—'}</td>
      <td className="audit-cell audit-cell-mono">{event.resource_id?.slice(0, 12) ?? '—'}</td>
      <td className="audit-cell audit-cell-actor">{actor}</td>
      <td className="audit-cell audit-cell-time">{formatDateTime(event.created_at)}</td>
    </tr>
  )
}

export default function Activity() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [apiKey, setApiKey] = useState(getActiveApiKey())
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [dateFilter, setDateFilter] = useState('30d')
  const [tab, setTab] = useState('summary')

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  // cursors[i] is the cursor to use to fetch page i+1 (cursors[0]=null for page 1)
  const [cursors, setCursors] = useState([null])
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const PAGE_LIMIT = 20

  useEffect(() => {
    getMe().then(setUser).catch(() => navigate('/login', { replace: true }))
  }, [navigate])

  const handleInvalidKey = useCallback((msg) => {
    clearActiveApiKey()
    setApiKey('')
    setSummary(null)
    setEvents([])
    setSummaryError(msg || 'API key is invalid or has been revoked. Enter a new key.')
    setEventsError('')
  }, [])

  const fetchSummary = useCallback(() => {
    if (!apiKey) return
    setSummaryLoading(true)
    setSummaryError('')
    const params = {}
    const since = sinceParam(dateFilter)
    if (since) params.since = since
    getActivitySummary(params)
      .then((raw) => setSummary(raw))
      .catch((e) => {
        if (e.status === 401) { handleInvalidKey(); return }
        setSummaryError(e.message)
      })
      .finally(() => setSummaryLoading(false))
  }, [apiKey, dateFilter, handleInvalidKey])

  const fetchEventsPage = useCallback((cursor, targetPage) => {
    if (!apiKey) return
    setEventsLoading(true)
    setEventsError('')
    const params = { limit: PAGE_LIMIT }
    const since = sinceParam(dateFilter)
    if (since) params.since = since
    if (actorFilter === 'me') params.actor = 'me'
    if (cursor) params.cursor = cursor
    listAuditEvents(params)
      .then((data) => {
        setEvents(normalizeAuditList(data))
        setCurrentPage(targetPage)
        setHasMore(data?.has_more ?? false)
        if (data?.next_cursor) {
          setCursors((prev) => {
            const updated = [...prev]
            updated[targetPage] = data.next_cursor
            return updated
          })
        }
      })
      .catch((e) => {
        if (e.status === 401) { handleInvalidKey(); return }
        setEventsError(e.message)
      })
      .finally(() => setEventsLoading(false))
  }, [apiKey, dateFilter, actorFilter])

  const fetchEvents = useCallback(() => {
    setCursors([null])
    setCurrentPage(1)
    setHasMore(false)
    fetchEventsPage(null, 1)
  }, [fetchEventsPage])

  const goNextPage = useCallback(() => {
    fetchEventsPage(cursors[currentPage] ?? null, currentPage + 1)
  }, [fetchEventsPage, cursors, currentPage])

  const goPrevPage = useCallback(() => {
    fetchEventsPage(cursors[currentPage - 2] ?? null, currentPage - 1)
  }, [fetchEventsPage, cursors, currentPage])

  useEffect(() => {
    if (tab === 'summary') fetchSummary()
    else fetchEvents()
  }, [tab, fetchSummary, fetchEvents])

  const handleSaveApiKey = () => {
    const k = apiKeyInput.trim()
    if (!k) return
    setActiveApiKey(k)
    setApiKey(k)
    setApiKeyInput('')
  }

  const handleClearApiKey = () => {
    clearActiveApiKey()
    setApiKey('')
    setSummary(null)
    setEvents([])
  }

  const handleLogout = async () => {
    await logout()
    clearToken()
    clearActiveApiKey()
    navigate('/login', { replace: true })
  }

  const resources = summary?.resource_counts || {}
  const callSummary = summary?.call_summary || {}
  const byStatus = Array.isArray(callSummary.by_status) ? callSummary.by_status : []
  const auditActions = Array.isArray(summary?.audit_actions) ? summary.audit_actions : []
  const errorSignals = summary?.error_signals || {}

  return (
    <div className="page">
      <header className="header">
        <img src="/oneinbox-logo-dark.svg" alt="OneInbox" className="logo" />
        <div className="header-actions">
          {user?.email && <span className="muted">{user.email}</span>}
          <button type="button" className="btn ghost" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="main main-wide">
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
        </nav>

        <h1 className="page-title">Activity</h1>

        {/* Revoked-key error sits above the key entry form */}
        {!apiKey && summaryError && (
          <p className="error banner" style={{ marginBottom: '1rem' }}>{summaryError}</p>
        )}

        {/* API Key Banner */}
        {!apiKey ? (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="muted" style={{ margin: '0 0 0.75rem' }}>
              Enter your secret API key (<code>oi_sk_...</code>) to load analytics.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                type="password"
                placeholder="oi_sk_..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
              />
              <button type="button" className="btn primary" onClick={handleSaveApiKey}>Save</button>
            </div>
          </div>
        ) : (
          <div className="api-key-banner" style={{ marginBottom: '1.5rem' }}>
            <span className="muted">Using key ending in <code>···{apiKey.slice(-6)}</code></span>
            <button type="button" className="btn ghost sm" onClick={handleClearApiKey}>Change key</button>
          </div>
        )}

        {/* Controls */}
        <div className="activity-controls">
          <div className="tab-group">
            <button
              type="button"
              className={`tab-btn${tab === 'summary' ? ' tab-btn-active' : ''}`}
              onClick={() => setTab('summary')}
            >
              Summary
            </button>
            <button
              type="button"
              className={`tab-btn${tab === 'events' ? ' tab-btn-active' : ''}`}
              onClick={() => setTab('events')}
            >
              Audit Feed
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {tab === 'events' && (
              <select
                className="filter-select"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
              >
                <option value="all">All actors</option>
                <option value="me">This API key only</option>
              </select>
            )}
            <select
              className="filter-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn ghost sm"
              onClick={tab === 'summary' ? fetchSummary : fetchEvents}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Tab */}
        {tab === 'summary' && (
          <>
            {summaryError && apiKey && <p className="error banner">{summaryError}</p>}
            {summaryLoading && <p className="muted" style={{ padding: '2rem 0' }}>Loading…</p>}
            {!apiKey && <p className="muted" style={{ padding: '2rem 0' }}>Add an API key above to load activity.</p>}

            {summary && (
              <>
                <SectionTitle>Resources</SectionTitle>
                <div className="stat-grid">
                  <StatCard label="Agents" value={resources.agents} />
                  <StatCard label="Phone Numbers" value={resources.phone_numbers} />
                  <StatCard label="Knowledge Bases" value={resources.knowledge_bases} />
                  <StatCard label="Tools" value={resources.tools} />
                  <StatCard label="Credentials" value={resources.credentials} />
                  <StatCard label="API Keys" value={resources.api_keys} />
                </div>

                <SectionTitle>Calls</SectionTitle>
                <div className="stat-grid">
                  <StatCard label="Total Calls" value={callSummary.total} />
                  {byStatus.map((s, i) => {
                    const label = s.status ?? s.name ?? s.value ?? s.label ??
                      Object.keys(s).find((k) => k !== 'count') ?? 'unknown'
                    return (
                      <StatCard
                        key={String(label) + i}
                        label={String(label).replace(/_/g, ' ')}
                        value={s.count ?? 0}
                        sub={String(label) === 'failed' && s.count > 0 ? 'check logs' : null}
                      />
                    )
                  })}
                </div>

                <SectionTitle>Audit Actions</SectionTitle>
                <div className="audit-actions-grid">
                  {auditActions.length === 0 ? (
                    <p className="muted" style={{ padding: '0.75rem 1rem' }}>No audit actions in this period.</p>
                  ) : (
                    auditActions
                      .slice()
                      .sort((a, b) => b.count - a.count)
                      .map((item) => (
                        <div key={item.action} className="audit-action-row">
                          <code className="audit-action">{item.action}</code>
                          <span className="audit-action-count">{item.count}</span>
                        </div>
                      ))
                  )}
                </div>

                <SectionTitle>Error Signals</SectionTitle>
                <div className="card" style={{ padding: '1rem 1.25rem' }}>
                  <div className="audit-action-row">
                    <span className="muted">calls ended in error</span>
                    <span style={{ color: errorSignals.calls_ended_in_error > 0 ? '#dc2626' : '#6b7280', fontWeight: 600 }}>
                      {errorSignals.calls_ended_in_error ?? 0}
                    </span>
                  </div>
                  <div className="audit-action-row">
                    <span className="muted">webhook deliveries failed</span>
                    <span style={{ color: errorSignals.webhook_deliveries_failed > 0 ? '#dc2626' : '#6b7280', fontWeight: 600 }}>
                      {errorSignals.webhook_deliveries_failed ?? 0}
                    </span>
                  </div>
                  {Array.isArray(errorSignals.kb_sources_errored) && errorSignals.kb_sources_errored.length > 0 && (
                    <div className="audit-action-row">
                      <span className="muted">KB sources errored</span>
                      <span style={{ color: '#dc2626', fontWeight: 600 }}>{errorSignals.kb_sources_errored.length}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* Audit Feed Tab */}
        {tab === 'events' && (
          <>
            {eventsError && apiKey && <p className="error banner">{eventsError}</p>}
            {eventsLoading && <p className="muted" style={{ padding: '2rem 0' }}>Loading…</p>}
            {!apiKey && <p className="muted" style={{ padding: '2rem 0' }}>Add an API key above to load audit events.</p>}

            {!eventsLoading && apiKey && events.length === 0 && !eventsError && (
              <p className="muted" style={{ padding: '2rem 0' }}>No events in this period.</p>
            )}

            {events.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th className="audit-th">Action</th>
                        <th className="audit-th">Resource Type</th>
                        <th className="audit-th">Resource ID</th>
                        <th className="audit-th">Actor</th>
                        <th className="audit-th">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e, i) => <AuditRow key={e.id || i} event={e} />)}
                    </tbody>
                  </table>
                </div>
                <div className="audit-footer">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={goPrevPage}
                    disabled={currentPage === 1 || eventsLoading}
                  >
                    ← Prev
                  </button>
                  <span className="audit-page-label">
                    Page {currentPage}
                    {actorFilter === 'me' ? ' · this key only' : ''}
                  </span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={goNextPage}
                    disabled={!hasMore || eventsLoading}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

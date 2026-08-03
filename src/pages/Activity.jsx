import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  clearActiveApiKey,
  getActiveApiKey,
  getActivitySummary,
  getActivityTimeseries,
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
  { label: 'Custom range', value: 'custom' },
]

function getDateParams(dateFilter, customFrom, customTo) {
  const params = {}
  if (dateFilter === 'custom') {
    if (customFrom) params.since = new Date(customFrom).toISOString()
    if (customTo) {
      const d = new Date(customTo)
      d.setHours(23, 59, 59, 999)
      params.until = d.toISOString()
    }
    return params
  }
  const now = new Date()
  if (dateFilter === '1d') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    params.since = d.toISOString()
  } else if (dateFilter === '7d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    params.since = d.toISOString()
  }
  return params
}

function formatDateTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return value }
}

function fmtDuration(s) {
  if (s == null) return '—'
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function fmtCost(cents) {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
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

function DistList({ items, total, barClass }) {
  if (!items || items.length === 0) return null
  return (
    <div className="dist-list">
      {items.map((item, i) => {
        const label = item.value ?? item.label ?? item.name ?? `item-${i}`
        const count = item.count ?? 0
        const pct = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={String(label) + i} className="dist-row">
            <span className="dist-label">{String(label).replace(/_/g, ' ')}</span>
            <div className="dist-bar-bg">
              <div className={`dist-bar-fill${barClass ? ` ${barClass}` : ''}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="dist-count">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return null
  const W = 600
  const H = 60
  const pad = 4
  const vals = points.map(p => p.calls)
  const max = Math.max(...vals, 1)
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = vals.map(v => H - pad - (v / max) * (H - 2 * pad))
  const line = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
  const fill = [`${xs[0]},${H}`, ...xs.map((x, i) => `${x},${ys[i]}`), `${xs[xs.length - 1]},${H}`].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '60px', display: 'block' }}>
      <polygon points={fill} fill="#2563eb" opacity="0.07" />
      <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinejoin="round" />
      {vals.map((v, i) => v > 0 && (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="3" fill="#2563eb" />
      ))}
    </svg>
  )
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
      <td className="audit-cell audit-cell-mono" title={event.resource_id ?? ''}>
        {event.resource_id ?? '—'}
      </td>
      <td className="audit-cell audit-cell-actor">{actor}</td>
      <td className="audit-cell audit-cell-time">{formatDateTime(event.created_at)}</td>
    </tr>
  )
}

function exportCsv(events) {
  const headers = ['Action', 'Resource Type', 'Resource ID', 'Actor', 'Time']
  const rows = events.map(e => {
    const actor = e.api_key_id
      ? `key·${e.api_key_id.slice(0, 8)}`
      : e.user_id ? `user·${e.user_id.slice(0, 8)}` : ''
    return [e.action || '', e.resource_type || '', e.resource_id || '', actor, e.created_at || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  })
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Activity() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [apiKey, setApiKey] = useState(getActiveApiKey())
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [dateFilter, setDateFilter] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [tab, setTab] = useState('summary')

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [timeseries, setTimeseries] = useState([])
  const [knownActions, setKnownActions] = useState([])

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const autoRefreshRef = useRef(null)
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
    const dateParams = getDateParams(dateFilter, customFrom, customTo)
    const rawTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const TZ_ALIASES = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'America/Godthab': 'America/Nuuk' }
    const tz = TZ_ALIASES[rawTz] || rawTz
    Promise.allSettled([
      getActivitySummary(dateParams),
      getActivityTimeseries({ bucket: 'day', tz, ...dateParams }),
    ])
      .then(([summaryResult, tsResult]) => {
        if (summaryResult.status === 'rejected') {
          const e = summaryResult.reason
          if (e.status === 401) { handleInvalidKey(); return }
          setSummaryError(e.message)
          return
        }
        const raw = summaryResult.value
        setSummary(raw)
        if (Array.isArray(raw?.known_actions)) setKnownActions(raw.known_actions)
        if (tsResult.status === 'fulfilled') {
          setTimeseries(Array.isArray(tsResult.value?.points) ? tsResult.value.points : [])
        }
      })
      .finally(() => setSummaryLoading(false))
  }, [apiKey, dateFilter, customFrom, customTo, handleInvalidKey])

  const fetchEventsPage = useCallback((cursor, targetPage) => {
    if (!apiKey) return
    setEventsLoading(true)
    setEventsError('')
    const params = { limit: PAGE_LIMIT, ...getDateParams(dateFilter, customFrom, customTo) }
    if (actorFilter === 'me') params.actor = 'me'
    if (actionFilter !== 'all') params.action = actionFilter
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
  }, [apiKey, dateFilter, customFrom, customTo, actorFilter, actionFilter, handleInvalidKey])

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (tab === 'summary') fetchSummary()
    else fetchEvents()
  }, [tab, fetchSummary, fetchEvents])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (autoRefresh && tab === 'events') {
      autoRefreshRef.current = setInterval(fetchEvents, 30000)
    }
    return () => clearInterval(autoRefreshRef.current)
  }, [autoRefresh, tab, fetchEvents])

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
  const byDirection = Array.isArray(callSummary.by_direction) ? callSummary.by_direction : []
  const byOutcome = Array.isArray(callSummary.by_outcome) ? callSummary.by_outcome : []
  const byEndReason = Array.isArray(callSummary.by_end_reason) ? callSummary.by_end_reason : []
  const callMetrics = summary?.call_metrics || {}
  const byAgent = Array.isArray(summary?.by_agent) ? summary.by_agent : []
  const auditActions = Array.isArray(summary?.audit_actions) ? summary.audit_actions : []
  const errorSignals = summary?.error_signals || {}

  const activeSparkPoints = timeseries.filter(p => p.calls > 0)

  return (
    <div className="page">
      <header className="header">
        <img src="/logo.svg" alt="OneInbox" className="logo" />
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
          <NavLink to="/billing" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            Billing
          </NavLink>
        </nav>

        <h1 className="page-title">Activity</h1>

        {!apiKey && summaryError && (
          <p className="error banner" style={{ marginBottom: '1rem' }}>{summaryError}</p>
        )}

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

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {tab === 'events' && (
              <>
                <select
                  className="filter-select"
                  value={actorFilter}
                  onChange={(e) => setActorFilter(e.target.value)}
                >
                  <option value="all">All actors</option>
                  <option value="me">This API key only</option>
                </select>
                {knownActions.length > 0 && (
                  <select
                    className="filter-select"
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                  >
                    <option value="all">All actions</option>
                    {knownActions.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <select
              className="filter-select"
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setCustomFrom(''); setCustomTo('') }}
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {dateFilter === 'custom' && (
              <>
                <input
                  type="date"
                  className="date-input"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <span className="muted" style={{ fontSize: '0.75rem' }}>to</span>
                <input
                  type="date"
                  className="date-input"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </>
            )}
            {tab === 'events' && (
              <>
                <button
                  type="button"
                  className={`btn ghost sm${autoRefresh ? ' btn-active' : ''}`}
                  onClick={() => setAutoRefresh(v => !v)}
                  title="Auto-refresh every 30s"
                >
                  {autoRefresh ? '⏸ Auto' : '▶ Auto'}
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => exportCsv(events)}
                  disabled={events.length === 0}
                >
                  Export CSV
                </button>
              </>
            )}
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
                  {resources.users != null && (
                    <StatCard label="Users" value={resources.users} />
                  )}
                </div>

                <SectionTitle>Calls</SectionTitle>
                <div className="stat-grid">
                  <StatCard label="Total Calls" value={callSummary.total} />
                  {byStatus.map((s, i) => {
                    const label = s.status ?? s.value ?? s.name ?? `status-${i}`
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

                {(callMetrics.minutes != null || callMetrics.cost_cents != null) && (
                  <>
                    <SectionTitle>Call Metrics</SectionTitle>
                    <div className="stat-grid">
                      {callMetrics.minutes != null && (
                        <StatCard label="Minutes Used" value={Number(callMetrics.minutes).toFixed(1)} />
                      )}
                      {callMetrics.cost_cents != null && (
                        <StatCard label="Carrier Cost" value={fmtCost(callMetrics.cost_cents)} sub="Twilio / carrier" />
                      )}
                      {callMetrics.avg_duration_seconds != null && (
                        <StatCard label="Avg Duration" value={fmtDuration(callMetrics.avg_duration_seconds)} />
                      )}
                      {callMetrics.p50_duration_seconds != null && (
                        <StatCard label="P50 Duration" value={fmtDuration(callMetrics.p50_duration_seconds)} />
                      )}
                      {callMetrics.p95_duration_seconds != null && (
                        <StatCard label="P95 Duration" value={fmtDuration(callMetrics.p95_duration_seconds)} />
                      )}
                      {callMetrics.max_duration_seconds != null && (
                        <StatCard label="Max Duration" value={fmtDuration(callMetrics.max_duration_seconds)} />
                      )}
                    </div>
                  </>
                )}

                {byDirection.length > 0 && (
                  <>
                    <SectionTitle>Direction</SectionTitle>
                    <DistList items={byDirection} total={callSummary.total} />
                  </>
                )}

                {byOutcome.length > 0 && (
                  <>
                    <SectionTitle>Outcomes</SectionTitle>
                    <DistList items={byOutcome} total={callSummary.total} barClass="dist-bar-green" />
                  </>
                )}

                {byEndReason.length > 0 && (
                  <>
                    <SectionTitle>End Reasons</SectionTitle>
                    <DistList items={byEndReason} total={callSummary.total} barClass="dist-bar-amber" />
                  </>
                )}

                {timeseries.length > 1 && (
                  <>
                    <SectionTitle>Calls Over Time</SectionTitle>
                    <div className="sparkline-card">
                      <div className="sparkline-title">Daily call volume</div>
                      <Sparkline points={timeseries} />
                      {activeSparkPoints.length > 0 && (
                        <div className="sparkline-legend">
                          {activeSparkPoints.slice(-4).map(p => (
                            <span key={p.bucket_start} className="sparkline-legend-item">
                              {new Date(p.bucket_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {' '}<strong>{p.calls}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {byAgent.length > 0 && (
                  <>
                    <SectionTitle>By Agent</SectionTitle>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="agent-table">
                          <thead>
                            <tr>
                              <th className="agent-th">Agent</th>
                              <th className="agent-th">Calls</th>
                              <th className="agent-th">Minutes</th>
                              <th className="agent-th">Avg Duration</th>
                            </tr>
                          </thead>
                          <tbody>
                            {byAgent.map(a => (
                              <tr key={a.agent_id} className="agent-row">
                                <td className="agent-cell agent-cell-name">
                                  {a.agent_name || a.agent_id}
                                  {!a.is_active && <span className="agent-inactive"> · deleted</span>}
                                </td>
                                <td className="agent-cell">{a.calls}</td>
                                <td className="agent-cell">{a.minutes != null ? Number(a.minutes).toFixed(1) : '—'}</td>
                                <td className="agent-cell">{fmtDuration(a.avg_duration_seconds)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

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
                    {actorFilter === 'me' ? ' · this key' : ''}
                    {actionFilter !== 'all' ? ` · ${actionFilter}` : ''}
                    {autoRefresh ? ' · live' : ''}
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

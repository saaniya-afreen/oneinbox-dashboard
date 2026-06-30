import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  clearActiveApiKey,
  getActiveApiKey,
  getCall,
  getMe,
  listCalls,
  logout,
  normalizeCallList,
  setActiveApiKey,
} from '../api/client'
import { clearToken } from '../auth'

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'no-answer',
  'no_answer',
  'busy',
  'canceled',
  'cancelled',
])

function isLive(status) {
  return !TERMINAL_STATUSES.has((status || '').toLowerCase())
}

function formatDateTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return `${Math.round(ms).toLocaleString()}ms`
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// Groups latency.events by turn and sums eou_delay + llm_ttft + tts_ttfb + kb per turn.
// kb (knowledge base retrieval) must be included — when a turn triggers a real KB
// lookup, the events array shows llm_ttft -> kb -> llm_ttft (decide to search, then
// answer using the result), and dropping the kb leg silently undercounts that turn.
const TURN_LATENCY_TYPES = ['eou_delay', 'llm_ttft', 'tts_ttfb', 'kb']

function computeLatencySummary(call) {
  const latency = call?.latency
  if (!latency) return null

  const turns = {}
  for (const e of latency.events || []) {
    if (!TURN_LATENCY_TYPES.includes(e.type)) continue
    turns[e.turn] = (turns[e.turn] || 0) + e.ms
  }
  const turnTotals = Object.values(turns)

  const connectMs = latency.connect?.setup_ms ?? null

  // KB isn't given its own aggregate object the way stt/llm_ttft/tts_ttfb/eou_delay
  // are, so it's computed here from the raw events.
  const kbTimes = (latency.events || []).filter((e) => e.type === 'kb').map((e) => e.ms)
  const kbStats = kbTimes.length
    ? {
        count: kbTimes.length,
        avg: kbTimes.reduce((a, b) => a + b, 0) / kbTimes.length,
        max: Math.max(...kbTimes),
        p50: [...kbTimes].sort((a, b) => a - b)[Math.floor((kbTimes.length - 1) / 2)],
      }
    : null

  if (turnTotals.length === 0) {
    return { connectMs, avg: null, peak: null, min: null, sampleCount: 0, kbStats }
  }

  const avg = turnTotals.reduce((a, b) => a + b, 0) / turnTotals.length
  const peak = Math.max(...turnTotals)
  const min = Math.min(...turnTotals)

  return { connectMs, avg, peak, min, sampleCount: turnTotals.length, kbStats }
}

function StatusBadge({ status }) {
  const live = isLive(status)
  return (
    <span className={`status-badge ${live ? 'status-live' : 'status-done'}`}>
      {live && <span className="live-dot" />}
      {status || 'unknown'}
    </span>
  )
}

function IconPhone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function CallRow({ call, onClick, active }) {
  return (
    <button type="button" className={`call-row ${active ? 'call-row-active' : ''}`} onClick={onClick}>
      <div className="call-row-icon">
        <IconPhone />
      </div>
      <div className="call-row-main">
        <div className="call-row-top">
          <span className="call-row-number">{call.to_number || call.from_number || 'Web call'}</span>
          <StatusBadge status={call.status} />
        </div>
        <div className="call-row-meta">
          {formatDateTime(call.created_at)}
          {call.duration_seconds != null && <span> &middot; {formatDuration(call.duration_seconds)}</span>}
          {call.outcome && <span> &middot; {call.outcome}</span>}
        </div>
      </div>
    </button>
  )
}

function LatencyCard({ label, value, hint }) {
  return (
    <div className="latency-card">
      <div className="latency-card-label">{label}</div>
      <div className="latency-card-value">{value}</div>
      {hint && <div className="latency-card-hint">{hint}</div>}
    </div>
  )
}

function ToolCallBadge({ toolCall, toolResult }) {
  const [expanded, setExpanded] = useState(false)

  let query = ''
  try {
    const args = JSON.parse(toolCall.arguments || '{}')
    query = args.query || Object.values(args)[0] || ''
  } catch {
    query = toolCall.arguments || ''
  }

  return (
    <div className="tool-call-badge">
      <button type="button" className="tool-call-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className="tool-call-icon">🔍</span>
        <span>
          Searched knowledge base{query ? `: "${query}"` : ''}
        </span>
        <span className="tool-call-chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre className="tool-call-result">
          {toolResult ? toolResult.content : 'No result captured for this lookup.'}
        </pre>
      )}
    </div>
  )
}

// Renders the structured messages array instead of the raw transcript string —
// the raw string interleaves full KB search results (huge PDF chunks, mixed-language
// text) directly between conversation turns, which makes the actual back-and-forth
// unreadable. Tool calls are collapsed into a small expandable badge instead.
function TranscriptView({ messages }) {
  if (!messages || messages.length === 0) return null

  const items = []
  messages.forEach((m, i) => {
    if (m.role === 'agent' || m.role === 'user') {
      items.push({ type: 'turn', message: m, key: i })
    } else if (m.role === 'tool_call') {
      const result = messages.find((r) => r.role === 'tool_result' && r.tool_call_id === m.tool_call_id)
      items.push({ type: 'tool', toolCall: m, toolResult: result, key: i })
    }
    // tool_result entries are matched and rendered alongside their tool_call above, skipped here
  })

  return (
    <div className="transcript-list">
      {items.map((item) =>
        item.type === 'turn' ? (
          <p key={item.key} className={`transcript-line transcript-${item.message.role}`}>
            <strong>{item.message.role === 'agent' ? 'Assistant' : 'User'}:</strong> {item.message.content}
          </p>
        ) : (
          <ToolCallBadge key={item.key} toolCall={item.toolCall} toolResult={item.toolResult} />
        )
      )}
    </div>
  )
}

function CallDetail({ call }) {
  if (!call) {
    return (
      <div className="call-detail call-detail-empty">
        <p className="muted">Select a call to see the transcript and latency breakdown.</p>
      </div>
    )
  }

  const live = isLive(call.status)
  const summary = computeLatencySummary(call)
  const latency = call.latency

  return (
    <div className="call-detail">
      <div className="call-detail-header">
        <div>
          <h2>{call.to_number || call.from_number || 'Web call'}</h2>
          <p className="muted">
            {formatDateTime(call.created_at)}
            {call.duration_seconds != null && <span> &middot; {formatDuration(call.duration_seconds)}</span>}
          </p>
        </div>
        <StatusBadge status={call.status} />
      </div>

      {live && (
        <div className="live-banner">
          <span className="live-dot" />
          Live — transcript updates automatically every 2 seconds
        </div>
      )}

      <section className="meta-section">
        <div className="meta-grid">
          {call.end_reason && (
            <div className="meta-item">
              <span className="meta-label">End reason</span>
              <span className="meta-value">{call.end_reason.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
          )}
          {call.outcome && (
            <div className="meta-item">
              <span className="meta-label">Outcome</span>
              <span className="meta-value">{call.outcome}</span>
            </div>
          )}
          {call.metadata?.concurrency_at_dispatch != null && (
            <div className="meta-item">
              <span className="meta-label">Concurrency at dispatch</span>
              <span className="meta-value">{call.metadata.concurrency_at_dispatch}</span>
            </div>
          )}
          {latency?.providers && (
            <div className="meta-item">
              <span className="meta-label">Providers</span>
              <span className="meta-value">
                {latency.providers.stt} / {latency.providers.llm} / {latency.providers.tts}
              </span>
            </div>
          )}
          {latency?.worker && (
            <div className="meta-item">
              <span className="meta-label">Worker</span>
              <span className="meta-value">
                {latency.worker.worker_id} &middot; load {latency.worker.load1} &middot; mem {latency.worker.mem_pct}%
              </span>
            </div>
          )}
          {call.credits_used != null && (
            <div className="meta-item">
              <span className="meta-label">Cost</span>
              <span className="meta-value">
                {call.credits_used} credits{call.cost_cents != null ? ` (${call.cost_cents}¢)` : ''}
              </span>
            </div>
          )}
          {call.recording_url && (
            <div className="meta-item">
              <span className="meta-label">Recording</span>
              <a href={call.recording_url} target="_blank" rel="noreferrer" className="meta-link">
                Listen
              </a>
            </div>
          )}
        </div>
      </section>

      <section className="latency-section">
        <h3>Latency breakdown</h3>
        {summary && summary.sampleCount > 0 ? (
          <>
            <div className="latency-cards">
              <LatencyCard label="Connect / setup" value={formatMs(summary.connectMs)} hint="Dead air before greeting" />
              <LatencyCard label="Average (mean)" value={formatMs(summary.avg)} hint={`${summary.sampleCount} turns`} />
              <LatencyCard label="Peak (max)" value={formatMs(summary.peak)} hint="Slowest turn" />
              <LatencyCard label="Best (min)" value={formatMs(summary.min)} hint="Fastest turn" />
            </div>
            {latency?.connect && (
              <p className="connect-breakdown muted">
                Connect breakdown: dispatch&rarr;answer {formatMs(latency.connect.dispatch_to_answer_ms)}
                &nbsp;&middot;&nbsp; answer&rarr;active {formatMs(latency.connect.answer_to_active_ms)}
                &nbsp;&middot;&nbsp; active&rarr;greeting {formatMs(latency.connect.active_to_greeting_ms)}
              </p>
            )}
            {latency && (
              <table className="latency-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Avg</th>
                    <th>Max</th>
                    <th>p50</th>
                  </tr>
                </thead>
                <tbody>
                  {['stt', 'llm_ttft', 'tts_ttfb', 'eou_delay'].map((key) => {
                    const c = latency[key]
                    if (!c) return null
                    return (
                      <tr key={key}>
                        <td>{key.replace('_', ' ')}</td>
                        <td>{formatMs(c.avg_ms)}</td>
                        <td>{formatMs(c.max_ms)}</td>
                        <td>{formatMs(c.p50_ms)}</td>
                      </tr>
                    )
                  })}
                  {summary.kbStats && (
                    <tr className="latency-row-kb">
                      <td>knowledge base ({summary.kbStats.count})</td>
                      <td>{formatMs(summary.kbStats.avg)}</td>
                      <td>{formatMs(summary.kbStats.max)}</td>
                      <td>{formatMs(summary.kbStats.p50)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="muted">No latency data yet{live ? ' — waiting for the call to progress.' : '.'}</p>
        )}
      </section>

      <section className="transcript-section">
        <h3>Transcript {live && <span className="muted">(live)</span>}</h3>
        {call.messages && call.messages.length > 0 ? (
          <div className="transcript-box">
            <TranscriptView messages={call.messages} />
          </div>
        ) : call.transcript ? (
          <pre className="transcript-box">{call.transcript}</pre>
        ) : (
          <p className="muted">{live ? 'Waiting for the conversation to start…' : 'No transcript available.'}</p>
        )}
      </section>
    </div>
  )
}

function ApiKeyBanner({ apiKey, onSave, onClear }) {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(!apiKey)

  if (apiKey && !editing) {
    return (
      <div className="apikey-banner apikey-banner-set">
        <span>
          Using API key <code>{apiKey.slice(0, 10)}…{apiKey.slice(-4)}</code> to load call data.
        </span>
        <button type="button" className="btn ghost btn-sm" onClick={() => setEditing(true)}>
          Change
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={() => {
            onClear()
            setEditing(true)
          }}
        >
          Clear
        </button>
      </div>
    )
  }

  return (
    <div className="apikey-banner">
      <span className="muted">
        Call data comes from your secret API key, not your login — paste one of your keys
        (Settings → API Keys) to load it. Stored only in this browser.
      </span>
      <form
        className="apikey-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          onSave(value.trim())
          setEditing(false)
          setValue('')
        }}
      >
        <input
          type="password"
          placeholder="oi_sk_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn add-key btn-sm">
          Save
        </button>
      </form>
    </div>
  )
}

export default function CallLogs() {
  const navigate = useNavigate()
  const [calls, setCalls] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedCall, setSelectedCall] = useState(null)
  const [apiKey, setApiKey] = useState(() => getActiveApiKey())

  const pollRef = useRef(null)
  const listPollRef = useRef(null)

  const loadList = useCallback(async () => {
    if (!getActiveApiKey()) {
      setLoading(false)
      return
    }
    try {
      const [callsData, meData] = await Promise.all([
        listCalls({ limit: 50 }),
        getMe().catch(() => null),
      ])
      setCalls(normalizeCallList(callsData))
      if (meData) setUser(meData)
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load call logs')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + background refresh of the list every 5s (so new/live calls show up)
  useEffect(() => {
    loadList()
    listPollRef.current = setInterval(loadList, 5000)
    return () => clearInterval(listPollRef.current)
  }, [loadList, apiKey])

  // Selected call: load detail, and poll every 2s while it's still live
  useEffect(() => {
    if (!selectedId) {
      setSelectedCall(null)
      return
    }

    let cancelled = false

    async function fetchDetail() {
      try {
        const data = await getCall(selectedId)
        if (!cancelled) setSelectedCall(data)
        if (cancelled || !isLive(data.status)) {
          clearInterval(pollRef.current)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load call')
        clearInterval(pollRef.current)
      }
    }

    fetchDetail()
    pollRef.current = setInterval(fetchDetail, 2000)

    return () => {
      cancelled = true
      clearInterval(pollRef.current)
    }
  }, [selectedId])

  async function handleLogout() {
    await logout()
    clearToken()
    navigate('/login', { replace: true })
  }

  function handleSaveApiKey(key) {
    setActiveApiKey(key)
    setApiKey(key)
    setLoading(true)
    loadList()
  }

  function handleClearApiKey() {
    clearActiveApiKey()
    setApiKey('')
    setCalls([])
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

      <main className="main main-wide">
        <nav className="top-nav">
          <NavLink to="/api-keys" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            API Keys
          </NavLink>
          <NavLink to="/calls" className={({ isActive }) => 'top-nav-link' + (isActive ? ' top-nav-link-active' : '')}>
            Call Logs
          </NavLink>
        </nav>

        <h1 className="page-title">Call Logs</h1>

        <ApiKeyBanner apiKey={apiKey} onSave={handleSaveApiKey} onClear={handleClearApiKey} />

        {error && <p className="error banner">{error}</p>}

        <div className="call-logs-layout">
          <section className="call-list-card">
            {!apiKey ? (
              <p className="keys-empty muted">Add an API key above to load calls.</p>
            ) : loading ? (
              <p className="keys-empty muted">Loading…</p>
            ) : calls.length === 0 ? (
              <p className="keys-empty muted">No calls yet.</p>
            ) : (
              <div className="call-list">
                {calls.map((call) => (
                  <CallRow
                    key={call.id}
                    call={call}
                    active={call.id === selectedId}
                    onClick={() => setSelectedId(call.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="call-detail-card">
            <CallDetail call={selectedCall} />
          </section>
        </div>
      </main>
    </div>
  )
}

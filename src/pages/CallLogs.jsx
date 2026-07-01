import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const PAGE_SIZE = 20

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

const TURN_LATENCY_TYPES = ['eou_delay', 'llm_ttft', 'tts_ttfb', 'kb']

function isToolEvent(type) {
  return type && (type.startsWith('tool:') || type === 'tool')
}

function computeLatencySummary(call) {
  const latency = call?.latency
  if (!latency) return null

  const turns = {}
  for (const e of latency.events || []) {
    if (!TURN_LATENCY_TYPES.includes(e.type) && !isToolEvent(e.type)) continue
    turns[e.turn] = (turns[e.turn] || 0) + e.ms
  }
  const turnTotals = Object.values(turns)

  const connectMs = latency.connect?.setup_ms ?? null

  const kbTimes = (latency.events || []).filter((e) => e.type === 'kb').map((e) => e.ms)
  const kbStats = kbTimes.length
    ? {
        count: kbTimes.length,
        avg: kbTimes.reduce((a, b) => a + b, 0) / kbTimes.length,
        max: Math.max(...kbTimes),
        p50: [...kbTimes].sort((a, b) => a - b)[Math.floor((kbTimes.length - 1) / 2)],
      }
    : null

  // Aggregate tool latencies by tool name
  const toolMap = {}
  for (const e of latency.events || []) {
    if (!isToolEvent(e.type)) continue
    const name = e.type.startsWith('tool:') ? e.type.slice(5) : 'tool'
    if (!toolMap[name]) toolMap[name] = []
    toolMap[name].push(e.ms)
  }
  const toolStats = Object.entries(toolMap).map(([name, times]) => ({
    name,
    count: times.length,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    max: Math.max(...times),
    p50: [...times].sort((a, b) => a - b)[Math.floor((times.length - 1) / 2)],
  }))

  if (turnTotals.length === 0) {
    return { connectMs, avg: null, peak: null, min: null, sampleCount: 0, kbStats, toolStats }
  }

  const avg = turnTotals.reduce((a, b) => a + b, 0) / turnTotals.length
  const peak = Math.max(...turnTotals)
  const min = Math.min(...turnTotals)

  return { connectMs, avg, peak, min, sampleCount: turnTotals.length, kbStats, toolStats }
}

function getDateRange(dateFilter) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (dateFilter === 'today') return { from: todayStart, to: null }
  if (dateFilter === 'yesterday') {
    const from = new Date(todayStart)
    from.setDate(from.getDate() - 1)
    return { from, to: todayStart }
  }
  if (dateFilter === 'week') {
    const from = new Date(todayStart)
    from.setDate(from.getDate() - 6)
    return { from, to: null }
  }
  return { from: null, to: null }
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

function DirectionBadge({ type, direction }) {
  const val = type || direction
  if (!val) return null
  const isIn = val === 'inbound'
  return (
    <span className="direction-badge" style={{ color: isIn ? '#2563eb' : '#7c3aed' }}>
      {isIn ? '↙ inbound' : '↗ outbound'}
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
          {(call.type || call.direction) && (
            <span> &middot; <DirectionBadge type={call.type} direction={call.direction} /></span>
          )}
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

function toolIcon(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('search') || n.includes('knowledge')) return '🔍'
  if (n.includes('transfer')) return '📞'
  if (n.includes('email')) return '✉️'
  if (n.includes('sms') || n.includes('text')) return '💬'
  if (n.includes('calendar') || n.includes('schedule') || n.includes('book')) return '📅'
  if (n.includes('end_call') || n.includes('hangup')) return '🔚'
  return '🔧'
}

function ToolCallBadge({ toolCall, toolResult }) {
  const [expanded, setExpanded] = useState(false)

  let argsDisplay = ''
  try {
    const args = JSON.parse(toolCall.arguments || '{}')
    const entries = Object.entries(args)
    if (entries.length > 0) {
      argsDisplay = entries.map(([k, v]) => `${k}: ${v}`).join(', ')
    }
  } catch {
    argsDisplay = toolCall.arguments || ''
  }

  const isError = toolResult?.is_error
  const hasContent = toolResult && toolResult.content

  return (
    <div className="tool-call-badge">
      <button
        type="button"
        className={`tool-call-toggle ${isError ? 'tool-call-toggle-error' : ''}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tool-call-icon">{toolIcon(toolCall.name)}</span>
        <code className="tool-call-name">{toolCall.name}</code>
        {argsDisplay && <span className="tool-call-args">({argsDisplay})</span>}
        <span className="tool-call-chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre className="tool-call-result">
          {hasContent ? toolResult.content : 'No result captured.'}
        </pre>
      )}
    </div>
  )
}

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
  const aiSummary = call.ai_summary || call.analysis?.summary
  const sentiment = call.analysis?.sentiment
  const extracted = call.analysis?.extracted_data?.post_call
  const leadInfo = call.analysis?.extracted_data?.capture_lead_info

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <StatusBadge status={call.status} />
          <DirectionBadge type={call.type} direction={call.direction} />
        </div>
      </div>

      {live && (
        <div className="live-banner">
          <span className="live-dot" />
          In progress — transcript will appear automatically when the call ends
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
          {call.from_number && call.to_number && (
            <div className="meta-item">
              <span className="meta-label">From</span>
              <span className="meta-value">{call.from_number}</span>
            </div>
          )}
          {call.started_at && (
            <div className="meta-item">
              <span className="meta-label">Started</span>
              <span className="meta-value">{formatDateTime(call.started_at)}</span>
            </div>
          )}
          {call.ended_at && (
            <div className="meta-item">
              <span className="meta-label">Ended</span>
              <span className="meta-value">{formatDateTime(call.ended_at)}</span>
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
          {call.twilio_call_sid && (
            <div className="meta-item">
              <span className="meta-label">Twilio SID</span>
              <span className="meta-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>{call.twilio_call_sid}</span>
            </div>
          )}
          {sentiment && (
            <div className="meta-item">
              <span className="meta-label">Sentiment</span>
              <span className={`sentiment-badge sentiment-${sentiment}`}>{sentiment}</span>
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

      {aiSummary && (
        <section className="ai-summary-section">
          <h3>AI Summary</h3>
          <p className="ai-summary-text">{aiSummary}</p>
        </section>
      )}

      {(extracted || leadInfo) && (
        <section className="analysis-section">
          <h3>Analysis</h3>
          <div className="analysis-grid">
            {extracted?.entities && Object.keys(extracted.entities).length > 0 && (
              <div className="analysis-card">
                <div className="analysis-card-title">Entities captured</div>
                {Object.entries(extracted.entities).map(([k, v]) => v && (
                  <div key={k} className="analysis-kv">
                    <span className="analysis-key">{k.replace(/_/g, ' ')}</span>
                    <span className="analysis-val">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {leadInfo && (
              <div className="analysis-card">
                <div className="analysis-card-title">Lead info</div>
                {Object.entries(leadInfo).map(([k, v]) => v != null && (
                  <div key={k} className="analysis-kv">
                    <span className="analysis-key">{k.replace(/_/g, ' ')}</span>
                    <span className="analysis-val">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {extracted?.key_points?.length > 0 && (
              <div className="analysis-card analysis-card-wide">
                <div className="analysis-card-title">Key points</div>
                <ul className="analysis-list">
                  {extracted.key_points.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {extracted?.action_items?.length > 0 && (
              <div className="analysis-card analysis-card-wide">
                <div className="analysis-card-title">
                  Action items
                  {extracted.follow_up_needed && <span className="follow-up-badge">follow-up needed</span>}
                </div>
                <ul className="analysis-list">
                  {extracted.action_items.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="latency-section">
        <h3>Latency breakdown</h3>
        {summary && summary.sampleCount > 0 ? (
          <>
            <div className="latency-cards">
              <LatencyCard label="Connect / setup" value={formatMs(summary.connectMs)} hint="Dead air before greeting" />
              <LatencyCard label="Average (mean)" value={formatMs(summary.avg)} hint={`${summary.sampleCount} turns`} />
              <LatencyCard label="Peak (max)" value={formatMs(summary.peak)} hint="Slowest turn" />
              <LatencyCard label="Best (min)" value={formatMs(summary.min)} hint="Fastest turn" />
              {latency?.perceived && (
                <LatencyCard label="Perceived avg" value={formatMs(latency.perceived.avg_ms)} hint={`${latency.perceived.turns} turns · p50 ${formatMs(latency.perceived.p50_ms)}`} />
              )}
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
                  {summary.toolStats?.map((t) => (
                    <tr key={t.name} className="latency-row-tool">
                      <td>🔧 {t.name}{t.count > 1 ? ` (×${t.count})` : ''}</td>
                      <td>{formatMs(t.avg)}</td>
                      <td>{formatMs(t.max)}</td>
                      <td>{formatMs(t.p50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="muted">No latency data yet{live ? ' — waiting for the call to progress.' : '.'}</p>
        )}
      </section>

      <section className="transcript-section">
        <h3>Transcript {live && <span className="muted">(updating when call ends)</span>}</h3>
        {call.messages && call.messages.length > 0 ? (
          <div className="transcript-box">
            <TranscriptView messages={call.messages} />
          </div>
        ) : call.transcript ? (
          <pre className="transcript-box">{call.transcript}</pre>
        ) : (
          <p className="muted">{live ? 'Transcript will appear here once the call ends.' : 'No transcript available.'}</p>
        )}
      </section>
    </div>
  )
}

function FilterBar({ filters, onChange, outcomes, endReasons }) {
  const hasActive = filters.date !== 'all' || filters.status || filters.outcome || filters.endReason

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <label className="filter-label">Date</label>
        <select className="filter-select" value={filters.date} onChange={(e) => onChange({ ...filters, date: e.target.value })}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Status</label>
        <select className="filter-select" value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="in-progress">In progress</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">End reason</label>
        <select className="filter-select" value={filters.endReason} onChange={(e) => onChange({ ...filters, endReason: e.target.value })}>
          <option value="">All</option>
          {endReasons.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Outcome</label>
        <select className="filter-select" value={filters.outcome} onChange={(e) => onChange({ ...filters, outcome: e.target.value })}>
          <option value="">All</option>
          {outcomes.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>

      {hasActive && (
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={() => onChange({ date: 'all', status: '', outcome: '', endReason: '' })}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function Pagination({ page, pageCount, total, onPrev, onNext }) {
  if (pageCount <= 1) return null
  return (
    <div className="pagination">
      <button type="button" className="btn ghost btn-sm" onClick={onPrev} disabled={page === 0}>
        ← Prev
      </button>
      <span className="pagination-info">
        Page {page + 1} of {pageCount} &middot; {total} calls
      </span>
      <button type="button" className="btn ghost btn-sm" onClick={onNext} disabled={page >= pageCount - 1}>
        Next →
      </button>
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
  const [allCalls, setAllCalls] = useState([])
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedCall, setSelectedCall] = useState(null)
  const [apiKey, setApiKey] = useState(() => getActiveApiKey())
  const [filters, setFilters] = useState({ date: 'today', status: '', outcome: '', endReason: '' })
  const [page, setPage] = useState(0)

  const pollRef = useRef(null)
  const listPollRef = useRef(null)

  const loadList = useCallback(async () => {
    if (!getActiveApiKey()) {
      setLoading(false)
      return
    }
    try {
      const [callsData, meData] = await Promise.all([
        listCalls({ limit: 100 }),
        getMe().catch(() => null),
      ])
      setAllCalls(normalizeCallList(callsData))
      if (meData) setUser(meData)
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load call logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
    listPollRef.current = setInterval(loadList, 5000)
    return () => clearInterval(listPollRef.current)
  }, [loadList, apiKey])

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

  // Derive unique outcome/end_reason values for filter dropdowns
  const { outcomes, endReasons } = useMemo(() => {
    const os = new Set()
    const er = new Set()
    for (const c of allCalls) {
      if (c.outcome) os.add(c.outcome)
      if (c.end_reason) er.add(c.end_reason)
    }
    return { outcomes: [...os].sort(), endReasons: [...er].sort() }
  }, [allCalls])

  // Apply filters
  const filteredCalls = useMemo(() => {
    let result = allCalls

    if (filters.date !== 'all') {
      const { from, to } = getDateRange(filters.date)
      result = result.filter((c) => {
        const created = new Date(c.created_at)
        if (from && created < from) return false
        if (to && created >= to) return false
        return true
      })
    }

    if (filters.status) {
      result = result.filter((c) => (c.status || '').toLowerCase() === filters.status)
    }
    if (filters.outcome) {
      result = result.filter((c) => c.outcome === filters.outcome)
    }
    if (filters.endReason) {
      result = result.filter((c) => c.end_reason === filters.endReason)
    }

    return result
  }, [allCalls, filters])

  const pageCount = Math.max(1, Math.ceil(filteredCalls.length / PAGE_SIZE))
  const pagedCalls = filteredCalls.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function handleFiltersChange(next) {
    setFilters(next)
    setPage(0)
  }

  async function handleLogout() {
    await logout()
    clearToken()
    clearActiveApiKey()
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
    setAllCalls([])
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

        <FilterBar
          filters={filters}
          onChange={handleFiltersChange}
          outcomes={outcomes}
          endReasons={endReasons}
        />

        <div className="filter-summary">
          {filteredCalls.length} call{filteredCalls.length !== 1 ? 's' : ''}
          {filters.date !== 'all' && ` · ${filters.date === 'today' ? 'today' : filters.date === 'yesterday' ? 'yesterday' : 'last 7 days'}`}
          {filters.status && ` · ${filters.status}`}
          {filters.outcome && ` · ${filters.outcome}`}
          {filters.endReason && ` · ${filters.endReason.replace(/_/g, ' ').toLowerCase()}`}
        </div>

        <div className="call-logs-layout">
          <section className="call-list-card">
            {!apiKey ? (
              <p className="keys-empty muted">Add an API key above to load calls.</p>
            ) : loading ? (
              <p className="keys-empty muted">Loading…</p>
            ) : pagedCalls.length === 0 ? (
              <p className="keys-empty muted">No calls match the current filters.</p>
            ) : (
              <>
                <div className="call-list">
                  {pagedCalls.map((call) => (
                    <CallRow
                      key={call.id}
                      call={call}
                      active={call.id === selectedId}
                      onClick={() => setSelectedId(call.id)}
                    />
                  ))}
                </div>
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  total={filteredCalls.length}
                  onPrev={() => setPage((p) => Math.max(0, p - 1))}
                  onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                />
              </>
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

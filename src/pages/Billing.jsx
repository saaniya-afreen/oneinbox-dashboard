import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createCheckout,
  getActiveApiKey,
  getAutoRecharge,
  getEffectiveRates,
  getLedger,
  getWallet,
  normalizeLedger,
  setActiveApiKey,
  setAutoRecharge,
} from '../api/client'
import { clearToken } from '../auth'

function logout(navigate) {
  clearToken()
  navigate('/login', { replace: true })
}

function StatusBadge({ status }) {
  const colors = {
    active: { bg: '#d1fae5', color: '#065f46' },
    frozen: { bg: '#fee2e2', color: '#991b1b' },
  }
  const s = colors[status] || { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  )
}

function formatDateTime(val) {
  if (!val) return '—'
  return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatEntry(type) {
  const map = {
    credit: { label: 'Top-up', color: '#065f46' },
    debit: { label: 'Call charge', color: '#991b1b' },
    admin_credit: { label: 'Admin credit', color: '#1d4ed8' },
    refund: { label: 'Refund', color: '#065f46' },
  }
  return map[type] || { label: type || 'Transaction', color: '#374151' }
}

const TOPUP_OPTIONS = [10, 25, 50, 100, 200]

export default function Billing() {
  const navigate = useNavigate()
  const hasKey = Boolean(getActiveApiKey())

  const [wallet, setWallet] = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState('')

  const [ledger, setLedger] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')

  const [rates, setRates] = useState(null)

  const [autoRecharge, setAutoRechargeData] = useState(null)
  const [arForm, setArForm] = useState({ enabled: false, threshold: 10, amount: 25, monthly_cap: 200 })
  const [arLoading, setArLoading] = useState(false)
  const [arMsg, setArMsg] = useState('')
  const [arError, setArError] = useState('')

  const [showTopup, setShowTopup] = useState(false)
  const [topupCredits, setTopupCredits] = useState(25)
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupError, setTopupError] = useState('')

  useEffect(() => {
    if (!hasKey) return

    setWalletLoading(true)
    getWallet()
      .then(setWallet)
      .catch((e) => {
        if (e.status === 401) { clearToken(); navigate('/login', { replace: true }); return }
        setWalletError(e.message)
      })
      .finally(() => setWalletLoading(false))

    setLedgerLoading(true)
    getLedger({ limit: 20, offset: 0 })
      .then((data) => setLedger(normalizeLedger(data)))
      .catch((e) => setLedgerError(e.message))
      .finally(() => setLedgerLoading(false))

    getEffectiveRates().then(setRates).catch(() => null)

    getAutoRecharge()
      .then((data) => {
        setAutoRechargeData(data)
        if (data) {
          setArForm({
            enabled: data.enabled ?? false,
            threshold: data.threshold ?? 10,
            amount: data.amount ?? 25,
            monthly_cap: data.monthly_cap ?? 200,
          })
        }
      })
      .catch(() => null)
  }, [hasKey, navigate])

  const handleTopup = async () => {
    setTopupLoading(true)
    setTopupError('')
    try {
      const origin = window.location.origin
      const data = await createCheckout(
        topupCredits,
        `${origin}/billing?topup=success`,
        `${origin}/billing`
      )
      const url = data?.url || data?.checkout_url || data?.session_url
      if (url) {
        window.location.href = url
      } else {
        setTopupError('No checkout URL returned. Check API response.')
      }
    } catch (e) {
      setTopupError(e.message)
    } finally {
      setTopupLoading(false)
    }
  }

  const handleSaveAutoRecharge = async (e) => {
    e.preventDefault()
    setArLoading(true)
    setArMsg('')
    setArError('')
    try {
      await setAutoRecharge({
        enabled: arForm.enabled,
        threshold: Number(arForm.threshold),
        amount: Number(arForm.amount),
        monthly_cap: Number(arForm.monthly_cap),
      })
      setArMsg('Auto-recharge settings saved.')
    } catch (e) {
      setArError(e.message)
    } finally {
      setArLoading(false)
    }
  }

  const topupSuccess = new URLSearchParams(window.location.search).get('topup') === 'success'

  return (
    <div className="page">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo.svg" alt="OneInbox" className="logo" />
        </div>
        <nav className="top-nav">
          <Link to="/api-keys" className="top-nav-link">API Keys</Link>
          <Link to="/publishable-keys" className="top-nav-link">Publishable Keys</Link>
          <Link to="/calls" className="top-nav-link">Calls</Link>
          <Link to="/billing" className="top-nav-link top-nav-link-active">Billing</Link>
          <Link to="/activity" className="top-nav-link">Activity</Link>
        </nav>
        <div className="header-actions">
          <button className="btn ghost" onClick={() => logout(navigate)}>Sign out</button>
        </div>
      </header>

      <main className="main">
        <h1 className="page-title">Billing</h1>

        {topupSuccess && (
          <div className="warning" style={{ background: '#d1fae5', borderColor: '#6ee7b7', color: '#065f46', marginBottom: 16 }}>
            Payment successful — your wallet has been topped up.
          </div>
        )}

        {!hasKey && (
          <div className="apikey-banner">
            <span style={{ display: 'block', marginBottom: 12 }}>
              Paste your secret API key (<code style={{ fontSize: 12 }}>oi_sk_...</code>) to load billing data.
              You can find it on the <Link to="/api-keys">API Keys</Link> page — copy it when you create or rotate a key.
            </span>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const val = e.target.apikey.value.trim()
                if (val.startsWith('oi_sk_')) {
                  setActiveApiKey(val)
                  window.location.reload()
                }
              }}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <input
                name="apikey"
                type="password"
                placeholder="oi_sk_..."
                style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
              />
              <button type="submit" style={{ padding: '7px 16px', fontSize: 13, background: '#111827', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Use this key
              </button>
            </form>
          </div>
        )}

        {hasKey && (
          <>
            {/* Wallet Card */}
            <div className="card" style={{ marginBottom: 24 }}>
              {walletLoading && <p className="muted">Loading wallet…</p>}
              {walletError && <p className="error">{walletError}</p>}
              {wallet && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 4 }}>
                      Balance
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                      ${Number(wallet.balance ?? 0).toFixed(2)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <StatusBadge status={wallet.status} />
                      <span style={{ fontSize: 13, color: '#6b7280' }}>
                        available: ${Number(wallet.available ?? 0).toFixed(2)}
                      </span>
                      {wallet.low_balance_threshold && (
                        <span style={{ fontSize: 13, color: '#6b7280' }}>
                          · alert below ${Number(wallet.low_balance_threshold).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="btn primary" onClick={() => setShowTopup((v) => !v)}>
                    {showTopup ? 'Cancel' : '+ Top Up'}
                  </button>
                </div>
              )}

              {showTopup && (
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
                  <p style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>Select amount to add (USD):</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {TOPUP_OPTIONS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setTopupCredits(amt)}
                        style={{
                          padding: '8px 18px',
                          borderRadius: 8,
                          border: `2px solid ${topupCredits === amt ? '#2563eb' : '#e5e7eb'}`,
                          background: topupCredits === amt ? '#eff6ff' : '#fff',
                          color: topupCredits === amt ? '#1d4ed8' : '#374151',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 14,
                        }}
                      >
                        ${amt}
                      </button>
                    ))}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={topupCredits}
                      onChange={(e) => setTopupCredits(Number(e.target.value))}
                      style={{ width: 90, padding: '8px 10px', border: '2px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
                    />
                  </div>
                  {topupError && <p className="error" style={{ marginBottom: 8 }}>{topupError}</p>}
                  <button className="btn primary" onClick={handleTopup} disabled={topupLoading || topupCredits < 1}>
                    {topupLoading ? 'Redirecting…' : `Pay $${topupCredits} via Stripe`}
                  </button>
                  <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 12 }}>You'll be redirected to Stripe's secure checkout.</span>
                </div>
              )}
            </div>

            {/* Rates */}
            {rates && (
              <div className="card" style={{ marginBottom: 24, padding: '1rem 1.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>
                  Your Rates
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {(() => {
                    // normalize: array of {component, rate_per_minute} OR flat object {key: number}
                    const items = Array.isArray(rates)
                      ? rates
                      : Array.isArray(rates?.items)
                      ? rates.items
                      : Array.isArray(rates?.rates)
                      ? rates.rates
                      : null

                    if (items) {
                      return items.map((r, i) => {
                        const label = (r.component || r.name || r.type || 'rate').replace(/_/g, ' ')
                        const val = r.rate_per_minute ?? r.rate ?? r.amount ?? r.value
                        return (
                          <div key={i}>
                            <span style={{ fontSize: 13, color: '#6b7280' }}>{label}: </span>
                            <span style={{ fontWeight: 600 }}>
                              {val != null ? `$${Number(val).toFixed(4)}/min` : '—'}
                            </span>
                          </div>
                        )
                      })
                    }

                    // fallback: flat object {key: number}
                    const flat = Object.entries(rates).filter(([, v]) => typeof v === 'number')
                    if (flat.length > 0) {
                      return flat.map(([k, v]) => (
                        <div key={k}>
                          <span style={{ fontSize: 13, color: '#6b7280' }}>{k.replace(/_/g, ' ')}: </span>
                          <span style={{ fontWeight: 600 }}>${Number(v).toFixed(4)}/min</span>
                        </div>
                      ))
                    }

                    return <span style={{ fontSize: 13, color: '#6b7280' }}>No rates configured yet.</span>
                  })()}
                </div>
              </div>
            )}

            {/* Auto-Recharge */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 12 }}>Auto-Recharge</div>
              {autoRecharge === null && !arError ? (
                <p className="muted">Loading…</p>
              ) : (
                <form onSubmit={handleSaveAutoRecharge}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={arForm.enabled}
                      onChange={(e) => setArForm((f) => ({ ...f, enabled: e.target.checked }))}
                    />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Enable auto-recharge</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>Automatically top up when balance drops below threshold</span>
                  </label>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Recharge when below ($)</label>
                      <input
                        type="number" min="0" step="1"
                        className="key-input"
                        style={{ width: 100 }}
                        value={arForm.threshold}
                        onChange={(e) => setArForm((f) => ({ ...f, threshold: e.target.value }))}
                        disabled={!arForm.enabled}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Recharge amount ($)</label>
                      <input
                        type="number" min="1" step="1"
                        className="key-input"
                        style={{ width: 100 }}
                        value={arForm.amount}
                        onChange={(e) => setArForm((f) => ({ ...f, amount: e.target.value }))}
                        disabled={!arForm.enabled}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Monthly cap ($)</label>
                      <input
                        type="number" min="0" step="1"
                        className="key-input"
                        style={{ width: 100 }}
                        value={arForm.monthly_cap}
                        onChange={(e) => setArForm((f) => ({ ...f, monthly_cap: e.target.value }))}
                        disabled={!arForm.enabled}
                      />
                    </div>
                  </div>
                  {arError && <p className="error" style={{ marginBottom: 8 }}>{arError}</p>}
                  {arMsg && <p style={{ fontSize: 13, color: '#065f46', marginBottom: 8 }}>{arMsg}</p>}
                  <button className="btn primary" type="submit" disabled={arLoading}>
                    {arLoading ? 'Saving…' : 'Save'}
                  </button>
                </form>
              )}
            </div>

            {/* Ledger */}
            <div className="card">
              <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 12 }}>Transaction History</div>
              {ledgerLoading && <p className="muted">Loading…</p>}
              {ledgerError && <p className="error">{ledgerError}</p>}
              {!ledgerLoading && ledger.length === 0 && !ledgerError && (
                <p className="muted">No transactions yet.</p>
              )}
              {ledger.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Type', 'Amount', 'Balance After', 'Description', 'Date'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((entry, i) => {
                        const { label, color } = formatEntry(entry.type || entry.entry_type)
                        const amount = Number(entry.amount ?? entry.delta ?? 0)
                        return (
                          <tr key={entry.id || i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color }}>{label}</td>
                            <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: amount >= 0 ? '#065f46' : '#991b1b' }}>
                              {amount >= 0 ? '+' : ''}${Math.abs(amount).toFixed(4)}
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                              {entry.balance_after != null ? `$${Number(entry.balance_after).toFixed(4)}` : '—'}
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 13, color: '#6b7280', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entry.description || entry.idempotency_key || '—'}
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
                              {formatDateTime(entry.created_at)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

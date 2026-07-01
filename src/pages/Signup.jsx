import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearActiveApiKey, signup } from '../api/client'
import { setToken } from '../auth'

export default function Signup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await signup(email, password, organizationName.trim() || undefined, name.trim() || undefined)
      if (!data?.access_token) {
        throw new Error('No access token returned')
      }
      setToken(data.access_token)
      clearActiveApiKey()
      navigate('/api-keys', { replace: true })
    } catch (err) {
      setError(err.message || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-center">
      <div className="card auth-card">
        <img src="/logo.svg" alt="OneInbox" className="logo" />
        <h1>Create account</h1>
        <p className="muted">Start managing your OneInbox API keys.</p>

        <form onSubmit={handleSubmit}>
          <label>
            Organization name <span className="muted">(optional)</span>
            <input
              type="text"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              autoComplete="organization"
              placeholder="Acme Inc."
            />
          </label>

          <label>
            Your name <span className="muted">(optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Jane Smith"
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer muted">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}

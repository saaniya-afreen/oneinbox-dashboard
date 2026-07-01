import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearActiveApiKey, login } from '../api/client'
import { setToken } from '../auth'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await login(email, password)
      if (!data?.access_token) {
        throw new Error('No access token returned')
      }
      setToken(data.access_token)
      clearActiveApiKey()
      navigate('/api-keys', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-center">
      <div className="card auth-card">
        <img src="/logo.svg" alt="OneInbox" className="logo" />
        <h1>Log in</h1>
        <p className="muted">Manage your OneInbox API keys.</p>

        <form onSubmit={handleSubmit}>
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
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-footer muted">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="auth-link">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}

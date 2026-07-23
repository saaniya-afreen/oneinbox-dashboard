import { Navigate, Route, Routes } from 'react-router-dom'
import { isAuthenticated } from './auth'
import Activity from './pages/Activity'
import ApiKeys from './pages/ApiKeys'
import Billing from './pages/Billing'
import PublishableKeys from './pages/PublishableKeys'
import CallLogs from './pages/CallLogs'
import Login from './pages/Login'
import Signup from './pages/Signup'

function RequireAuth({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return children
}

function RedirectIfAuth({ children }) {
  if (isAuthenticated()) {
    return <Navigate to="/api-keys" replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuth>
            <Login />
          </RedirectIfAuth>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuth>
            <Signup />
          </RedirectIfAuth>
        }
      />
      <Route
        path="/api-keys"
        element={
          <RequireAuth>
            <ApiKeys />
          </RequireAuth>
        }
      />
      <Route
        path="/publishable-keys"
        element={
          <RequireAuth>
            <PublishableKeys />
          </RequireAuth>
        }
      />
      <Route
        path="/calls"
        element={
          <RequireAuth>
            <CallLogs />
          </RequireAuth>
        }
      />
      <Route
        path="/activity"
        element={
          <RequireAuth>
            <Activity />
          </RequireAuth>
        }
      />
      <Route
        path="/billing"
        element={
          <RequireAuth>
            <Billing />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/api-keys" replace />} />
      <Route path="*" element={<Navigate to="/api-keys" replace />} />
    </Routes>
  )
}

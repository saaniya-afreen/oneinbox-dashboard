import { Navigate, Route, Routes } from 'react-router-dom'
import { isAuthenticated } from './auth'
import ApiKeys from './pages/ApiKeys'
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
      <Route path="/" element={<Navigate to="/api-keys" replace />} />
      <Route path="*" element={<Navigate to="/api-keys" replace />} />
    </Routes>
  )
}

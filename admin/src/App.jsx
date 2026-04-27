import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout    from './components/Layout';
import Login     from './pages/Login';
import Dashboard from './pages/Dashboard';
import Dictionary from './pages/Dictionary';
import AutoFetch   from './pages/AutoFetch';
import Wiktionary  from './pages/Wiktionary';
import Settings    from './pages/Settings';
import { getToken } from './api';

function Private({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Layout /></Private>}>
          <Route index          element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"  element={<Dashboard />} />
          <Route path="dictionary" element={<Dictionary />} />
          <Route path="autofetch"  element={<AutoFetch />} />
          <Route path="wiktionary" element={<Wiktionary />} />
          <Route path="settings"   element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

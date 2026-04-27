import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Zap, FileDown, Settings, LogOut, BookMarked, Wifi } from 'lucide-react';
import { clearToken } from '../api';

const nav = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/dictionary', icon: BookOpen,         label: 'Dictionary' },
  { to: '/autofetch',  icon: Zap,              label: 'Auto-Fetch' },
  { to: '/wiktionary', icon: FileDown,         label: 'Wiktionary' },
  { to: '/settings',   icon: Settings,         label: 'Settings'   },
];

export default function Layout() {
  const navigate = useNavigate();
  const logout   = () => { clearToken(); navigate('/login'); };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-[#0f0a2e] text-white">
        {/* Brand */}
        <div className="px-5 py-6 flex items-center gap-3 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center flex-shrink-0">
            <BookMarked size={18} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Vocab Admin</p>
            <p className="text-xs text-white/30 font-medium">Dictionary Manager</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                 ${isActive
                   ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25'
                   : 'text-white/50 hover:text-white/90 hover:bg-white/5'}`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/5">
          <div className="flex items-center gap-2 px-3 mb-3">
            <Wifi size={12} className="text-emerald-400" />
            <span className="text-xs text-white/30">API Connected</span>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

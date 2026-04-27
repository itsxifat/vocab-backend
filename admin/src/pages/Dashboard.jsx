import { useState, useEffect } from 'react';
import { BookOpen, Sparkles, TrendingUp, Clock, RefreshCw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
        {sub && <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{sub}</span>}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value ?? '—'}</div>
      <div className="text-xs font-medium text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function fmt(n) { return (n ?? 0).toLocaleString(); }
function relTime(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="font-medium">{label}</p>
      <p className="text-brand-300">{payload[0].value} words added</p>
    </div>
  );
};

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const d = await api.stats();
      setData(d);
    } catch {}
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  // Pad chart data to last 14 days
  const chartData = (() => {
    if (!data?.chartData) return [];
    const map = Object.fromEntries((data.chartData || []).map(d => [d._id, d.count]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      const key = d.toISOString().slice(0, 10);
      return { date: key.slice(5), words: map[key] || 0 };
    });
  })();

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Dictionary overview & activity</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={BookOpen}   label="Total Words"    value={fmt(data?.total)}   sub={data?.today > 0 ? `+${fmt(data?.today)} today` : null} color="bg-brand-500" />
        <StatCard icon={Sparkles}   label="Added Today"    value={fmt(data?.today)}   color="bg-emerald-500" />
        <StatCard icon={TrendingUp} label="This Week"      value={fmt(data?.week)}    color="bg-blue-500" />
        <StatCard icon={Clock}      label="Server Uptime"  value={fmtUptime(data?.uptime || 0)} color="bg-orange-500" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Chart */}
        <div className="col-span-2 bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-5">Words Added — Last 14 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7c5cfc" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#7c5cfc" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="words" stroke="#7c5cfc" strokeWidth={2} fill="url(#grad)" dot={false} activeDot={{ r: 4, fill: '#7c5cfc' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Recent words */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm overflow-hidden">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Recently Added</h2>
          <div className="space-y-2 overflow-y-auto max-h-56">
            {(data?.recent || []).map(w => (
              <div key={w.word} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                <span className="text-sm font-semibold text-brand-600">{w.word}</span>
                <span className="text-xs text-slate-400">{relTime(w.createdAt)}</span>
              </div>
            ))}
            {!data?.recent?.length && (
              <p className="text-sm text-slate-400 text-center py-6">No words yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Last fetch job */}
      {data?.lastJob && (
        <div className="mt-6 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Last Fetch Job</h2>
          <div className="flex items-center gap-6 flex-wrap">
            <JobStat label="Status"    value={data.lastJob.status}              color={data.lastJob.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'} />
            <JobStat label="Fetched"   value={fmt(data.lastJob.fetchedWords)}   color="text-brand-600" />
            <JobStat label="Failed"    value={fmt(data.lastJob.failedWords)}    color="text-red-500" />
            <JobStat label="Processed" value={`${fmt(data.lastJob.processedWords)} / ${fmt(data.lastJob.totalWords)}`} color="text-slate-700" />
          </div>
        </div>
      )}
    </div>
  );
}

function JobStat({ label, value, color }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

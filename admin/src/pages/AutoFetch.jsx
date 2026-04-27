import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, Square, RefreshCw, Plus, RotateCcw, Trash2,
  BookOpen, Globe, Database, Languages, Moon,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../api';

// ── Vendor config ─────────────────────────────────────────────────────────────
const VENDORS = [
  { id: 'freeDictionary', label: 'Free Dictionary',  desc: 'Free — definitions + phonetic', icon: BookOpen, always: true },
  { id: 'datamuse',       label: 'Datamuse',          desc: 'Free — synonyms & antonyms',   icon: Database, always: true },
  { id: 'merriamWebster', label: 'Merriam-Webster',   desc: 'Requires API key in Settings', icon: Globe,    always: false },
  { id: 'wordnik',        label: 'Wordnik',            desc: 'Requires API key in Settings', icon: Globe,    always: false },
  { id: 'translate',      label: 'Bengali Translate',  desc: 'Google Translate / MyMemory', icon: Languages, always: false },
];

const VENDOR_SHORT = {
  FreeDictionary: 'FD', Datamuse: 'DM', MerriamWebster: 'MW', Wordnik: 'WN',
};

// ── Small components ──────────────────────────────────────────────────────────
function VendorCard({ vendor, enabled, onChange }) {
  return (
    <div onClick={() => !vendor.always && onChange(!enabled)}
      className={`relative flex items-start gap-3 p-3 rounded-xl border transition-all
        ${vendor.always ? 'border-brand-200 bg-brand-50/40 cursor-default'
          : enabled ? 'border-brand-300 bg-brand-50 cursor-pointer shadow-sm'
          : 'border-slate-200 bg-white cursor-pointer hover:border-slate-300'}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${enabled || vendor.always ? 'bg-brand-500' : 'bg-slate-200'}`}>
        <vendor.icon size={13} className={enabled || vendor.always ? 'text-white' : 'text-slate-500'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${enabled || vendor.always ? 'text-brand-700' : 'text-slate-700'}`}>{vendor.label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{vendor.desc}</p>
      </div>
      {vendor.always
        ? <span className="text-xs font-semibold text-brand-500 bg-brand-100 px-1.5 py-0.5 rounded-full flex-shrink-0">On</span>
        : <div className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 mt-0.5 ${enabled ? 'bg-brand-500' : 'bg-slate-300'}`}>
            <div className={`w-3 h-3 rounded-full bg-white shadow m-0.5 transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
      }
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: 'bg-slate-100 text-slate-500', running: 'bg-blue-100 text-blue-600',
    stopped: 'bg-orange-100 text-orange-600', completed: 'bg-emerald-100 text-emerald-600',
    error:   'bg-red-100 text-red-600',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] || map.pending}`}>
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
      {status}
    </span>
  );
}

function QueueStat({ label, value, color, bg }) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center flex-1`}>
      <p className={`text-xl font-bold ${color}`}>{(value ?? 0).toLocaleString()}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function fmt(n) { return (n ?? 0).toLocaleString(); }
function relTime(d) {
  if (!d) return '—';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function duration(start, end) {
  if (!start) return '—';
  const s = Math.floor(((end ? new Date(end) : Date.now()) - new Date(start)) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const LOG_COLORS = {
  ok: 'text-emerald-400', error: 'text-red-400', warn: 'text-amber-400',
  info: 'text-slate-400', batch: 'text-brand-300 font-semibold',
  idle: 'text-purple-300', complete: 'text-emerald-300 font-semibold',
  retry: 'text-amber-300',
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AutoFetch() {
  const [queue,        setQueue]       = useState(null);   // { total, pending, fetched, failed }
  const [jobs,         setJobs]        = useState([]);
  const [activeJob,    setActiveJob]   = useState(null);
  const [concurrency,  setConcurrency] = useState(5);
  const [vendors,      setVendors]     = useState({ merriamWebster: false, wordnik: false, translate: true });
  const [logs,         setLogs]        = useState([]);
  const [progress,     setProgress]    = useState(null);
  const [running,      setRunning]     = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [showHistory,  setShowHistory] = useState(false);
  const [wordInput,    setWordInput]   = useState('');
  const [addingWords,  setAddingWords] = useState(false);
  const [idleMsg,      setIdleMsg]     = useState(null);

  const sseRef           = useRef(null);
  const logsRef          = useRef([]);
  const startTimeRef     = useRef(null);
  const closedRef        = useRef(false);
  const reconnectRef     = useRef(null);

  const pushLog = useCallback((entry) => {
    const log = { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), ...entry };
    logsRef.current = [log, ...logsRef.current].slice(0, 500);
    setLogs([...logsRef.current]);
  }, []);

  const loadQueue = async () => {
    try { setQueue(await api.queueStats()); } catch {}
  };

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.fetchJobs();
      setJobs(data);
      const active = data.find(j => j.status === 'running' || j.status === 'pending');
      if (active && !running) {
        setActiveJob(active);
        setRunning(true);
        connectSSE(active._id);
      }
    } catch {}
  }, [running]); // eslint-disable-line

  useEffect(() => {
    loadQueue();
    loadJobs();
    return () => { closedRef.current = true; sseRef.current?.close(); };
  }, []); // eslint-disable-line

  // ── SSE ────────────────────────────────────────────────────────────────────
  const connectSSE = useCallback((jobId) => {
    closedRef.current = false;
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    sseRef.current?.close();
    startTimeRef.current = Date.now();

    const token = getToken();
    const es = new EventSource(`/admin/api/autofetch/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`);
    sseRef.current = es;

    const closeSSE = () => {
      closedRef.current = true;
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      es.close();
    };

    es.onmessage = (e) => {
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }

      // ── Batch start ────────────────────────────────────────────────────────
      if (ev.t === 'batch') {
        setIdleMsg(null);
        setProgress({ fetched: ev.fetched, failed: ev.failed, processed: 0, total: ev.count });
        startTimeRef.current = Date.now();
        pushLog({ type: 'batch', msg: `── Fetching ${fmt(ev.count)} words ──` });
        return;
      }

      // ── Word result ────────────────────────────────────────────────────────
      if (ev.t === 'w') {
        setProgress(p => p ? { ...p, processed: ev.processed, fetched: ev.fetched, failed: ev.failed } : null);
        if (ev.s === 'ok') {
          const vStr = (ev.vendors || []).map(v => VENDOR_SHORT[v] || v).join('+');
          const parts = [];
          if (vStr)          parts.push(`[${vStr}]`);
          if (ev.defs > 0)   parts.push(`${ev.defs}def`);
          if (ev.syns > 0)   parts.push(`${ev.syns}syn`);
          if (ev.ants > 0)   parts.push(`${ev.ants}ant`);
          if (ev.hasBengali) parts.push('bn✓');
          if (ev.ms)         parts.push(`${ev.ms}ms`);
          pushLog({ type: 'ok', msg: `✓ ${ev.word}  ${parts.join(' ')}` });
        } else if (ev.s === 'nf') {
          pushLog({ type: ev.willRetry ? 'retry' : 'error', msg: `✗ ${ev.word} — not found${ev.willRetry ? ' (will retry)' : ' (max attempts)'}` });
        } else {
          pushLog({ type: 'error', msg: `✗ ${ev.word} — ${ev.err || 'error'}` });
        }
        // Refresh queue stats periodically (every 20 words)
        if (ev.processed % 20 === 0) loadQueue();
        return;
      }

      // ── Idle ───────────────────────────────────────────────────────────────
      if (ev.t === 'idle') {
        setIdleMsg(ev.msg);
        setProgress(null);
        setQueue({ total: ev.total, pending: ev.pending, fetched: ev.fetched, failed: ev.failed });
        pushLog({ type: 'idle', msg: `⏸ ${ev.msg}` });
        return;
      }

      // ── Done / Stopped / Error ─────────────────────────────────────────────
      if (ev.t === 'done') {
        setRunning(false); setProgress(null); setIdleMsg(null);
        setActiveJob(prev => prev ? { ...prev, status: ev.status || 'completed' } : null);
        pushLog({ type: 'complete', msg: `Done — ${fmt(ev.fetched)} fetched, ${fmt(ev.failed)} failed` });
        loadQueue(); loadJobs(); closeSSE();
        return;
      }
      if (ev.t === 'stopped') {
        setRunning(false); setProgress(null); setIdleMsg(null);
        pushLog({ type: 'warn', msg: 'Job stopped by user' });
        loadQueue(); loadJobs(); closeSSE();
        return;
      }
      if (ev.t === 'error') {
        setRunning(false); setProgress(null); setIdleMsg(null);
        pushLog({ type: 'error', msg: `Error: ${ev.message || 'Unknown error'}` });
        loadQueue(); loadJobs(); closeSSE();
      }
    };

    es.onerror = () => {
      if (closedRef.current) return;
      if (!reconnectRef.current) {
        reconnectRef.current = setTimeout(() => {
          reconnectRef.current = null;
          if (!closedRef.current) pushLog({ type: 'warn', msg: 'SSE connection interrupted — reconnecting…' });
        }, 3000);
      }
    };
  }, [pushLog, loadJobs]); // eslint-disable-line

  // ── Queue actions ───────────────────────────────────────────────────────────
  const addWords = async () => {
    const words = wordInput.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
    if (!words.length) return toast.error('Enter at least one word');
    setAddingWords(true);
    try {
      const r = await api.queueAdd(words);
      toast.success(`${r.added} new word(s) added to queue`);
      setWordInput('');
      setQueue(r.stats);
    } catch (e) { toast.error(e.message); }
    finally { setAddingWords(false); }
  };

  const resetFailed = async () => {
    try {
      const r = await api.queueResetFailed();
      toast.success(`${r.reset} failed words reset to pending`);
      setQueue(r.stats);
    } catch (e) { toast.error(e.message); }
  };

  const resetAll = async () => {
    if (!confirm('This marks every word as pending — all will be re-fetched. Continue?')) return;
    try {
      const r = await api.queueResetAll();
      toast.success('All words reset to pending');
      setQueue(r.stats);
    } catch (e) { toast.error(e.message); }
  };

  const clearQueue = async () => {
    if (!confirm('This removes ALL words from the queue (does not delete them from the dictionary). Continue?')) return;
    try {
      await api.queueClear();
      toast.success('Queue cleared');
      setQueue({ total: 0, pending: 0, fetched: 0, failed: 0 });
    } catch (e) { toast.error(e.message); }
  };

  // ── Fetch actions ───────────────────────────────────────────────────────────
  const startFetch = async () => {
    setLoading(true);
    logsRef.current = []; setLogs([]); setProgress(null); setIdleMsg(null);
    try {
      const { jobId } = await api.startFetch({ concurrency, enableTranslate: vendors.translate });
      toast.success('Fetch job started!');
      setRunning(true);
      setActiveJob({ _id: jobId, status: 'running', startedAt: new Date().toISOString() });
      connectSSE(jobId);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const stopFetch = async () => {
    setLoading(true);
    try { await api.stopFetch(); toast.success('Stop signal sent'); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const pct = progress?.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;

  const wordsPerSec = (() => {
    if (!progress?.processed || !startTimeRef.current) return null;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    return elapsed > 1 ? (progress.processed / elapsed).toFixed(1) : null;
  })();

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Auto-Fetch</h1>
          <p className="text-sm text-slate-400 mt-0.5">Add words to the queue — the fetcher runs continuously until stopped</p>
        </div>
        <button onClick={() => { loadQueue(); loadJobs(); }}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ── Left column ── */}
        <div className="col-span-1 space-y-5">

          {/* Word Queue */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Word Queue</h2>

            {/* Stats */}
            {queue ? (
              <div className="flex gap-2">
                <QueueStat label="Pending"  value={queue.pending}  color="text-amber-600"   bg="bg-amber-50" />
                <QueueStat label="Fetched"  value={queue.fetched}  color="text-emerald-600" bg="bg-emerald-50" />
                <QueueStat label="Failed"   value={queue.failed}   color="text-red-500"     bg="bg-red-50" />
              </div>
            ) : (
              <div className="h-12 bg-slate-50 rounded-xl animate-pulse" />
            )}

            {/* Add words */}
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">Add words (one per line or comma-separated)</label>
              <textarea
                value={wordInput}
                onChange={e => setWordInput(e.target.value)}
                placeholder={"apple\nbanana, cherry\nubiquitous"}
                rows={5}
                className="w-full text-sm px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 placeholder-slate-300 font-mono resize-none outline-none focus:border-brand-300 focus:bg-white transition-colors"
              />
              <button
                onClick={addWords}
                disabled={addingWords || !wordInput.trim()}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50 transition-colors">
                {addingWords
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Adding…</>
                  : <><Plus size={14} /> Add to Queue</>}
              </button>
            </div>

            {/* Queue actions */}
            <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
              {queue?.failed > 0 && (
                <button onClick={resetFailed}
                  className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors">
                  <RotateCcw size={12} /> Retry {fmt(queue.failed)} Failed Words
                </button>
              )}
              <button onClick={resetAll}
                className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors">
                <RotateCcw size={12} /> Re-fetch All (new API keys)
              </button>
              <button onClick={clearQueue}
                className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-50 border border-red-100 transition-colors">
                <Trash2 size={12} /> Clear Queue
              </button>
            </div>
          </div>

          {/* Concurrency */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Concurrency</h2>
              <span className="text-lg font-bold text-brand-600">{concurrency}</span>
            </div>
            <input type="range" min={1} max={10} value={concurrency}
              onChange={e => setConcurrency(+e.target.value)} disabled={running}
              className="w-full accent-brand-500 disabled:opacity-50" />
            <div className="flex justify-between text-xs text-slate-400 mt-1"><span>1</span><span>10</span></div>
            <p className="text-xs text-slate-400 mt-2">Failed words auto-retry after 60s cooldown.</p>
          </div>

          {/* Start / Stop */}
          <button
            onClick={running ? stopFetch : startFetch}
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors shadow-sm
              ${running ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60'}`}>
            {running
              ? <><Square size={15} fill="white" /> Stop Job</>
              : loading
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting…</>
                : <><Zap size={15} /> Start Fetching</>}
          </button>
        </div>

        {/* ── Right column ── */}
        <div className="col-span-2 space-y-5">

          {/* Vendors */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Data Sources</h2>
              <a href="/admin/settings" className="text-xs text-brand-500 hover:text-brand-600">Configure API keys →</a>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {VENDORS.map(v => (
                <VendorCard key={v.id} vendor={v}
                  enabled={v.always || !!vendors[v.id]}
                  onChange={val => setVendors(prev => ({ ...prev, [v.id]: val }))} />
              ))}
            </div>
          </div>

          {/* Progress / Idle */}
          {(running || progress || idleMsg) && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Progress</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {wordsPerSec && <span>{wordsPerSec}/s</span>}
                  {activeJob?.startedAt && <span>{duration(activeJob.startedAt)} elapsed</span>}
                  <StatusPill status={activeJob?.status || 'running'} />
                </div>
              </div>

              {idleMsg && !progress ? (
                <div className="flex items-center gap-3 py-4 text-purple-600">
                  <Moon size={18} />
                  <p className="text-sm">{idleMsg}</p>
                </div>
              ) : progress ? (
                <>
                  <div className="mb-4">
                    <div className="flex justify-between text-sm font-semibold text-slate-700 mb-1.5">
                      <span>{pct}%</span>
                      <span>{fmt(progress.processed)} / {fmt(progress.total)}</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-base font-bold text-emerald-600">{fmt(progress.fetched)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Fetched</p>
                    </div>
                    <div className="bg-red-50 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-base font-bold text-red-500">{fmt(progress.failed)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Failed (auto-retry)</p>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Live Log */}
          <div className="bg-[#0f0a2e] rounded-2xl border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div>
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider inline">Live Log</h2>
                <span className="ml-3 text-white/20 text-xs">FD=FreeDictionary DM=Datamuse MW=Merriam WN=Wordnik</span>
              </div>
              <button onClick={() => { logsRef.current = []; setLogs([]); }}
                className="text-xs text-white/20 hover:text-white/50 transition-colors flex-shrink-0">Clear</button>
            </div>
            <div className="h-96 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
              {logs.length === 0
                ? <p className="text-white/20 italic">Add words to the queue and start fetching…</p>
                : logs.map(log => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-white/20 flex-shrink-0 tabular-nums">{log.time}</span>
                    <span className={LOG_COLORS[log.type] || 'text-slate-400'}>{log.msg}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Job history */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <button onClick={() => setShowHistory(h => !h)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
          <span>Job History ({jobs.length})</span>
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showHistory && (
          <div className="border-t border-slate-100">
            {jobs.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">No jobs yet</p>
              : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['Status', 'Fetched', 'Failed', 'Processed', 'Duration', 'Started'].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(j => (
                      <tr key={j._id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3"><StatusPill status={j.status} /></td>
                        <td className="px-5 py-3 font-semibold text-emerald-600">{fmt(j.fetchedWords)}</td>
                        <td className="px-5 py-3 text-red-500">{fmt(j.failedWords)}</td>
                        <td className="px-5 py-3 text-slate-600">{fmt(j.processedWords)} / {fmt(j.totalWords)}</td>
                        <td className="px-5 py-3 text-slate-500">{duration(j.startedAt, j.completedAt)}</td>
                        <td className="px-5 py-3 text-xs text-slate-400">{relTime(j.startedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

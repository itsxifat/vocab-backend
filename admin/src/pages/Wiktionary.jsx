import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Square, RefreshCw, FileText, ChevronDown, ChevronUp,
  CheckCircle, XCircle, AlertTriangle, BookOpen, Database, Loader2, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../api';

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function StatusPill({ status }) {
  const map = {
    parsing:   'bg-blue-100 text-blue-600',
    completed: 'bg-emerald-100 text-emerald-600',
    stopped:   'bg-orange-100 text-orange-600',
    error:     'bg-red-100 text-red-600',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {status === 'parsing' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
      {status}
    </span>
  );
}

const LOG_COLORS = {
  start:   'text-brand-400',
  sample:  'text-emerald-400',
  p:       'text-slate-400',
  error:   'text-red-400',
  warn:    'text-amber-400',
  done:    'text-emerald-300 font-semibold',
  stopped: 'text-orange-300 font-semibold',
};

// ── Drop zone ─────────────────────────────────────────────────────────────────
function DropZone({ file, onFile, disabled }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const handle = (f) => {
    if (!f) return;
    if (!f.name.endsWith('.bz2') && !f.name.endsWith('.xml')) {
      toast.error('Please select a .xml or .xml.bz2 file');
      return;
    }
    onFile(f);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${drag ? 'border-brand-400 bg-brand-50' : file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30'}`}
    >
      <input ref={inputRef} type="file" accept=".bz2,.xml" className="hidden"
        onChange={e => handle(e.target.files[0])} disabled={disabled} />

      {file ? (
        <div className="space-y-1">
          <CheckCircle size={28} className="mx-auto text-emerald-500" />
          <p className="font-semibold text-slate-800 text-sm">{file.name}</p>
          <p className="text-xs text-slate-400">{fileSize(file.size)}</p>
          {!disabled && <p className="text-xs text-brand-500 mt-2">Click to change file</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <Upload size={28} className="mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Drop your Wiktionary dump here</p>
          <p className="text-xs text-slate-400">
            Accepts <code className="bg-slate-100 px-1 rounded">enwiktionary-latest-pages-articles.xml.bz2</code>
          </p>
          <p className="text-xs text-slate-400">or plain <code className="bg-slate-100 px-1 rounded">.xml</code> — up to 10 GB</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Wiktionary() {
  const [file,        setFile]       = useState(null);
  const [limit,       setLimit]      = useState(0);      // 0 = no limit
  const [overwrite,   setOverwrite]  = useState(true);
  const [phase,       setPhase]      = useState('idle'); // idle | uploading | parsing | done
  const [uploadPct,   setUploadPct]  = useState(0);
  const [progress,    setProgress]   = useState(null);   // { pages, found, saved }
  const [activeJob,   setActiveJob]  = useState(null);
  const [logs,        setLogs]       = useState([]);
  const [jobs,        setJobs]       = useState([]);
  const [recentWords, setRecentWords] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showWords,   setShowWords]  = useState(false);
  const [health,      setHealth]     = useState(null);   // null=loading, obj=result, 'error'=unreachable

  const sseRef           = useRef(null);
  const logsRef          = useRef([]);
  const startTimeRef     = useRef(null);
  const xhrRef           = useRef(null);
  const closedRef        = useRef(false);
  const reconnectTimerRef = useRef(null);

  const pushLog = useCallback((entry) => {
    const log = { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), ...entry };
    logsRef.current = [log, ...logsRef.current].slice(0, 500);
    setLogs([...logsRef.current]);
  }, []);

  const loadJobs = useCallback(async () => {
    try { setJobs(await api.wiktionaryJobs()); } catch {}
  }, []);

  const loadRecentWords = useCallback(async () => {
    try {
      const d = await api.recentWords(30);
      setRecentWords(d.words || []);
    } catch {}
  }, []);

  const checkHealth = useCallback(async () => {
    setHealth(null);
    try {
      const h = await api.health();
      setHealth(h);
      if (!h.ok) toast.error(`Server issue: DB is ${h.db}`);
    } catch (e) {
      setHealth({ error: e.message, network: e.network });
      toast.error(e.message);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    loadJobs();
    // If a parse job is already running, reconnect
    api.wiktionaryJobs().then(data => {
      const active = data.find(j => j.status === 'parsing');
      if (active) {
        setActiveJob(active);
        setPhase('parsing');
        connectSSE(active._id);
      }
    }).catch(() => {});
    return () => { closedRef.current = true; sseRef.current?.close(); };
  }, []); // eslint-disable-line

  // ── SSE ────────────────────────────────────────────────────────────────────
  const connectSSE = useCallback((jobId) => {
    closedRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    sseRef.current?.close();
    startTimeRef.current = Date.now();
    const token = getToken();
    const es = new EventSource(`/admin/api/wiktionary/stream?job=${jobId}&token=${encodeURIComponent(token)}`);
    sseRef.current = es;

    const closeSSE = () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      es.close();
    };

    es.onmessage = (e) => {
      // Clear any pending reconnect warning — we're receiving data fine
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }

      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }

      if (ev.t === 'start') {
        startTimeRef.current = Date.now();
        pushLog({ type: 'start', msg: `Parsing started: ${ev.filename}` });
        setPhase('parsing');
        return;
      }
      if (ev.t === 'p') {
        setProgress({ pages: ev.pages, found: ev.found, saved: ev.saved });
        pushLog({ type: 'p', msg: `Pages: ${fmt(ev.pages)} | English entries: ${fmt(ev.found)} | Saved: ${fmt(ev.saved)}` });
        return;
      }
      if (ev.t === 'sample') {
        pushLog({ type: 'sample', msg: `✓ ${ev.word}  —  ${ev.def.slice(0, 80)}${ev.def.length > 80 ? '…' : ''}` });
        return;
      }
      if (ev.t === 'done') {
        setPhase('done');
        setProgress({ pages: ev.pages, found: ev.found, saved: ev.saved });
        setActiveJob(prev => prev ? { ...prev, status: 'completed' } : null);
        const mins = Math.floor(ev.elapsed / 60), secs = ev.elapsed % 60;
        pushLog({ type: 'done', msg: `Import complete — ${fmt(ev.found)} entries found, ${fmt(ev.saved)} saved to DB in ${mins > 0 ? `${mins}m ` : ''}${secs}s` });
        loadJobs();
        loadRecentWords();
        setShowWords(true);
        closeSSE();
        return;
      }
      if (ev.t === 'stopped') {
        setPhase('done');
        setActiveJob(prev => prev ? { ...prev, status: 'stopped' } : null);
        pushLog({ type: 'stopped', msg: `Import stopped — ${fmt(ev.found)} found, ${fmt(ev.saved)} saved` });
        setProgress({ pages: ev.pages, found: ev.found, saved: ev.saved });
        loadJobs();
        closeSSE();
        return;
      }
      if (ev.t === 'error') {
        setPhase('done');
        pushLog({ type: 'error', msg: `Error: ${ev.message}` });
        loadJobs();
        closeSSE();
      }
    };

    // Debounce: only log a reconnect warning if 3 seconds pass without a message
    es.onerror = () => {
      if (closedRef.current) return;
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!closedRef.current) pushLog({ type: 'warn', msg: 'SSE connection dropped — reconnecting…' });
        }, 3000);
      }
    };
  }, [pushLog, loadJobs, loadRecentWords]); // eslint-disable-line

  // ── Upload via XHR (to get upload progress) ────────────────────────────────
  const startImport = () => {
    if (!file) return toast.error('Select a file first');
    setPhase('uploading');
    setUploadPct(0);
    logsRef.current = [];
    setLogs([]);
    setProgress(null);
    setRecentWords([]);

    const fd = new FormData();
    fd.append('dump',      file);
    fd.append('limit',     limit);
    fd.append('overwrite', overwrite);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 401) { window.location.href = '/login'; return; }
      if (xhr.status === 409) {
        const body = JSON.parse(xhr.responseText);
        toast.error('An import is already running');
        if (body.jobId) connectSSE(body.jobId);
        setPhase('parsing');
        return;
      }
      if (xhr.status !== 200) {
        const body = JSON.parse(xhr.responseText || '{}');
        toast.error(body.error || 'Upload failed');
        setPhase('idle');
        return;
      }
      const { jobId, filename } = JSON.parse(xhr.responseText);
      toast.success(`"${filename}" uploaded — parsing started`);
      setActiveJob({ _id: jobId, status: 'parsing', startedAt: new Date().toISOString(), filename });
      setPhase('parsing');
      connectSSE(jobId);
    };

    xhr.onerror = () => { toast.error('Upload failed'); setPhase('idle'); };

    xhr.open('POST', '/admin/api/wiktionary/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.send(fd);
  };

  const stopImport = async () => {
    try {
      await api.wiktionaryStop();
      toast.success('Stop signal sent');
    } catch (e) { toast.error(e.message); }
  };

  const cancelUpload = () => {
    xhrRef.current?.abort();
    setPhase('idle');
    setUploadPct(0);
  };

  const deleteFile = async (jobId) => {
    if (!confirm('Delete the uploaded dump file from disk? This cannot be undone.')) return;
    try {
      await api.deleteWiktionaryFile(jobId);
      toast.success('Dump file deleted from disk');
      loadJobs();
    } catch (e) { toast.error(e.message); }
  };

  const stopJob = async (jobId) => {
    try {
      await api.stopWiktionaryJob(jobId);
      toast.success('Stop signal sent');
      loadJobs();
    } catch (e) { toast.error(e.message); }
  };

  const deleteJob = async (jobId, hasFile) => {
    const msg = hasFile
      ? 'This will stop the import (if running), delete the temp dump file from disk, and remove the history record. Continue?'
      : 'Remove this job record from history?';
    if (!confirm(msg)) return;
    try {
      await api.deleteWiktionaryJob(jobId);
      toast.success('Job removed');
      loadJobs();
      // If we just deleted the active job, reset to idle
      if (activeJob?._id === jobId) { setPhase('idle'); setActiveJob(null); setProgress(null); sseRef.current?.close(); }
    } catch (e) { toast.error(e.message); }
  };

  // ── ETA ───────────────────────────────────────────────────────────────────
  const eta = (() => {
    if (!progress?.pages || !startTimeRef.current) return null;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const rate = progress.pages / elapsed;
    if (rate <= 0) return null;
    // Wiktionary dump has ~8M pages total
    const est = 8_000_000;
    const rem = (est - progress.pages) / rate;
    if (rem < 60)   return `~${Math.round(rem)}s`;
    if (rem < 3600) return `~${Math.round(rem / 60)}m`;
    return `~${Math.round(rem / 3600)}h`;
  })();

  const isActive = phase === 'uploading' || phase === 'parsing';

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Wiktionary Import</h1>
          <p className="text-sm text-slate-400 mt-0.5">Import 200k+ English words from the Wiktionary XML dump</p>
        </div>
        <button onClick={() => { checkHealth(); loadJobs(); if (phase === 'done') loadRecentWords(); }}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── Health / debug banner ── */}
      <HealthPanel health={health} />

      <div className="grid grid-cols-3 gap-6">
        {/* ── Left: upload form ── */}
        <div className="col-span-1 space-y-5">

          {/* Drop zone */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Dump File</h2>
            <DropZone file={file} onFile={setFile} disabled={isActive} />
          </div>

          {/* Options */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Options</h2>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">Word limit</label>
                <span className="text-sm font-bold text-brand-600">{limit === 0 ? 'All' : fmt(limit)}</span>
              </div>
              <input type="range" min={0} max={500000} step={10000} value={limit}
                onChange={e => setLimit(+e.target.value)} disabled={isActive}
                className="w-full accent-brand-500 disabled:opacity-50" />
              <div className="flex justify-between text-xs text-slate-400 mt-1"><span>All</span><span>500k</span></div>
              <p className="text-xs text-slate-400 mt-1">Set to limit how many entries are imported</p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-600">Overwrite existing</p>
                <p className="text-xs text-slate-400 mt-0.5">Update words already in the database</p>
              </div>
              <button onClick={() => setOverwrite(v => !v)} disabled={isActive}
                className={`w-10 h-6 rounded-full transition-colors disabled:opacity-50 ${overwrite ? 'bg-brand-500' : 'bg-slate-300'}`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow m-0.5 transition-transform ${overwrite ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          {/* Action button */}
          {phase === 'idle' || phase === 'done' ? (
            <button onClick={startImport} disabled={!file}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50 transition-colors shadow-sm">
              <Upload size={15} /> Start Import
            </button>
          ) : phase === 'uploading' ? (
            <div className="space-y-2">
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Uploading…</span><span>{uploadPct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
              <button onClick={cancelUpload}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors">
                Cancel Upload
              </button>
            </div>
          ) : (
            <button onClick={stopImport}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition-colors shadow-sm">
              <Square size={15} fill="white" /> Stop Import
            </button>
          )}
        </div>

        {/* ── Right: progress + log ── */}
        <div className="col-span-2 space-y-5">

          {/* Progress stats */}
          {(phase === 'parsing' || phase === 'done') && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Progress</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {eta && phase === 'parsing' && <span>ETA {eta}</span>}
                  {activeJob?.startedAt && <span>{duration(activeJob.startedAt)} elapsed</span>}
                  {activeJob && <StatusPill status={activeJob.status} />}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatBox icon={FileText}  label="Pages scanned" value={fmt(progress?.pages)} color="text-slate-700"   bg="bg-slate-50" />
                <StatBox icon={BookOpen}  label="Entries found" value={fmt(progress?.found)} color="text-brand-600"   bg="bg-brand-50" />
                <StatBox icon={Database}  label="Saved to DB"   value={fmt(progress?.saved)} color="text-emerald-600" bg="bg-emerald-50" />
              </div>
            </div>
          )}

          {/* Live log */}
          <div className="bg-[#0f0a2e] rounded-2xl border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider">Live Log</h2>
              <button onClick={() => { logsRef.current = []; setLogs([]); }}
                className="text-xs text-white/20 hover:text-white/50 transition-colors">Clear</button>
            </div>
            <div className="h-72 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
              {logs.length === 0
                ? <p className="text-white/20 italic">Select a file and click "Start Import" to begin…</p>
                : logs.map(log => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-white/20 flex-shrink-0 tabular-nums">{log.time}</span>
                    <span className={LOG_COLORS[log.type] || 'text-slate-400'}>{log.msg}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Recently imported words ── */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <button
          onClick={() => { setShowWords(v => !v); if (!showWords) loadRecentWords(); }}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span>Recently Imported Words ({recentWords.length})</span>
          {showWords ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showWords && (
          <div className="border-t border-slate-100">
            {recentWords.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No words yet — run an import first</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Word</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Definition</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Synonyms</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWords.map(w => (
                    <tr key={w.word} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3 font-bold text-brand-600">{w.word}</td>
                      <td className="px-5 py-3 text-slate-500 max-w-xs">
                        <span className="line-clamp-1 text-xs">{w.definitions?.[0] || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">{w.synonyms?.slice(0, 3).join(', ') || '—'}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{relTime(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Job history ── */}
      <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <button
          onClick={() => { setShowHistory(v => !v); if (!showHistory) loadJobs(); }}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span>Import History ({jobs.length})</span>
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showHistory && (
          <div className="border-t border-slate-100">
            {jobs.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No imports yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['File', 'Status', 'Pages', 'Found', 'Saved', 'Duration', 'Started', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j._id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-xs font-mono text-slate-700 max-w-[160px] truncate">{j.filename || '—'}</p>
                        {j.fileSize ? (
                          <p className={`text-xs mt-0.5 font-medium ${j.filePath ? 'text-amber-500' : 'text-slate-400 line-through'}`}>
                            {fileSize(j.fileSize)}{j.filePath ? ' on disk' : ' deleted'}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={j.status} /></td>
                      <td className="px-4 py-3 text-slate-500">{fmt(j.pagesScanned)}</td>
                      <td className="px-4 py-3 text-brand-600 font-semibold">{fmt(j.found)}</td>
                      <td className="px-4 py-3 text-emerald-600 font-semibold">{fmt(j.saved)}</td>
                      <td className="px-4 py-3 text-slate-500">{duration(j.startedAt, j.completedAt)}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{relTime(j.startedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {j.status === 'parsing' && (
                            <button onClick={() => stopJob(j._id)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors">
                              <Square size={10} fill="currentColor" /> Stop
                            </button>
                          )}
                          {j.filePath && j.status !== 'parsing' && (
                            <button onClick={() => deleteFile(j._id)}
                              title={`Free up ${j.fileSize ? fileSize(j.fileSize) : 'disk space'}`}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors">
                              <Trash2 size={10} /> {j.fileSize ? fileSize(j.fileSize) : 'File'}
                            </button>
                          )}
                          <button onClick={() => deleteJob(j._id, !!j.filePath)}
                            title="Remove this record"
                            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
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

function StatBox({ icon: Icon, label, value, color, bg }) {
  return (
    <div className={`${bg} rounded-xl px-4 py-3 flex items-center gap-3`}>
      <Icon size={18} className={color} />
      <div>
        <p className={`text-lg font-bold ${color}`}>{value ?? '—'}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function HealthPanel({ health }) {
  if (health === null) {
    return (
      <div className="flex items-center gap-2 mb-5 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5">
        <Loader2 size={13} className="animate-spin" /> Checking backend health…
      </div>
    );
  }

  if (health.error) {
    return (
      <div className="mb-5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <XCircle size={15} className="text-red-500" />
          <span className="text-sm font-bold text-red-700">
            {health.network ? 'Cannot reach backend server' : 'Backend error'}
          </span>
        </div>
        <p className="text-xs text-red-600 font-mono">{health.error}</p>
        {health.network && (
          <p className="text-xs text-red-500 mt-1.5">
            Make sure the backend is running: <code className="bg-red-100 px-1 rounded">cd backend && node server.js</code>
          </p>
        )}
      </div>
    );
  }

  const checks = [
    { label: 'Server',         ok: true,           detail: `up ${Math.floor((health.uptime || 0) / 60)}m` },
    { label: 'MongoDB',        ok: health.db === 'connected', detail: health.db },
    { label: 'multer',         ok: health.multer,   detail: health.multer ? 'installed' : 'MISSING — run npm install' },
    { label: 'sax',            ok: health.sax,      detail: health.sax    ? 'installed' : 'MISSING — run npm install' },
    { label: 'unbzip2-stream', ok: health.unbzip2,  detail: health.unbzip2 ? 'installed' : 'MISSING — run npm install' },
  ];

  const allOk = checks.every(c => c.ok);
  return (
    <div className={`mb-5 rounded-xl border px-4 py-3 ${allOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        {allOk
          ? <CheckCircle size={14} className="text-emerald-500" />
          : <AlertTriangle size={14} className="text-amber-500" />}
        <span className={`text-xs font-bold ${allOk ? 'text-emerald-700' : 'text-amber-700'}`}>
          {allOk ? 'All systems ready' : 'Issues detected — see below'}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {checks.map(c => (
          <span key={c.label} className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium
            ${c.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {c.ok ? <CheckCircle size={10} /> : <XCircle size={10} />}
            {c.label}
            <span className="opacity-70">· {c.detail}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

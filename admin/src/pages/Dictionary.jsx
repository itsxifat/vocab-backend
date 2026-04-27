import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';
import WordModal from '../components/WordModal';

function Badge({ children, color = 'slate' }) {
  const colors = { slate:'bg-slate-100 text-slate-600', brand:'bg-brand-50 text-brand-600', emerald:'bg-emerald-50 text-emerald-600' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>{children}</span>;
}

function relTime(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Dictionary() {
  const [words,   setWords]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [page,    setPage]    = useState(1);
  const [q,       setQ]       = useState('');
  const [loading, setLoading] = useState(false);
  const [modal,   setModal]   = useState(null); // null | 'new' | 'word-string'
  const searchTimer = useRef(null);

  const load = useCallback(async (p = page, query = q) => {
    setLoading(true);
    try {
      const d = await api.words(p, query);
      setWords(d.words); setTotal(d.total); setPages(d.pages);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, q]);

  useEffect(() => { load(); }, [page]);

  const onSearch = (v) => {
    setQ(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(1, v); }, 320);
  };

  const deleteWord = async (word) => {
    if (!confirm(`Delete "${word}"?`)) return;
    try {
      await api.deleteWord(word);
      toast.success(`"${word}" deleted`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const paginationPages = () => {
    const delta = 2, range = [], rangeWithDots = [];
    for (let i = Math.max(2, page - delta); i <= Math.min(pages - 1, page + delta); i++) range.push(i);
    if (range[0] - 1 === 2) range.unshift(2);
    if (pages - 1 - range[range.length - 1] === 1) range.push(pages - 1);
    rangeWithDots.push(1);
    if (range[0] > 2) rangeWithDots.push('...');
    rangeWithDots.push(...range);
    if (range[range.length - 1] < pages - 1) rangeWithDots.push('...');
    if (pages > 1) rangeWithDots.push(pages);
    return rangeWithDots;
  };

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dictionary</h1>
          <p className="text-sm text-slate-400 mt-0.5">{total.toLocaleString()} words total</p>
        </div>
        <button onClick={() => setModal('new')} className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
          <Plus size={15} /> Add Word
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={e => onSearch(e.target.value)} placeholder="Search words…"
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-brand-400 transition-all" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Word</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Definition</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Synonyms</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Bengali</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Added</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && !words.length ? (
              <tr><td colSpan={6} className="text-center py-16 text-slate-400">Loading…</td></tr>
            ) : words.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="flex flex-col items-center py-16 text-slate-400">
                    <BookOpen size={32} className="mb-3 opacity-30" />
                    <p className="font-medium">No words found</p>
                  </div>
                </td>
              </tr>
            ) : words.map(w => (
              <tr key={w.word} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-3 font-bold text-brand-600">{w.word}</td>
                <td className="px-5 py-3 text-slate-500 max-w-xs">
                  <span className="line-clamp-1">{w.definitions?.[0] || '—'}</span>
                </td>
                <td className="px-5 py-3">
                  {(w.synonyms?.length || 0) > 0
                    ? <Badge color="brand">{w.synonyms.length} syn</Badge>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-5 py-3">
                  {(w.bengali?.length || 0) > 0
                    ? <Badge color="emerald">{w.bengali.length} tr</Badge>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-5 py-3 text-xs text-slate-400">{relTime(w.createdAt)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setModal(w.word)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 transition-colors"><Pencil size={13} /></button>
                    <button onClick={() => deleteWord(w.word)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-5">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            <ChevronLeft size={14} />
          </button>
          {paginationPages().map((p, i) => p === '...'
            ? <span key={`d${i}`} className="px-2 text-slate-400">…</span>
            : <button key={p} onClick={() => setPage(p)} className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${page === p ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{p}</button>
          )}
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <WordModal word={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => load()} />
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';

function DynamicList({ items, onChange, placeholder }) {
  const update  = (i, v)  => { const n = [...items]; n[i] = v; onChange(n); };
  const remove  = (i)     => onChange(items.filter((_, j) => j !== i));
  const add     = ()      => onChange([...items, '']);
  return (
    <div className="space-y-1.5">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          <input value={v} onChange={e => update(i, e.target.value)} placeholder={placeholder}
            className="flex-1 text-sm px-3 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-brand-400 bg-slate-50 focus:bg-white transition-all" />
          <button type="button" onClick={() => remove(i)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13} /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium mt-1">
        <Plus size={12} /> Add
      </button>
    </div>
  );
}

export default function WordModal({ word: initialWord, onClose, onSaved }) {
  const isEdit = !!initialWord;
  const [word,        setWord]        = useState('');
  const [phonetic,    setPhonetic]    = useState('');
  const [definitions, setDefinitions] = useState(['']);
  const [bengali,     setBengali]     = useState(['']);
  const [synonyms,    setSynonyms]    = useState('');
  const [antonyms,    setAntonyms]    = useState('');
  const [examples,    setExamples]    = useState(['']);
  const [loading,     setLoading]     = useState(false);
  const [filling,     setFilling]     = useState(false);

  useEffect(() => {
    if (!initialWord) return;
    api.word(initialWord).then(d => {
      setWord(d.word);
      setPhonetic(d.phonetic || '');
      setDefinitions(d.definitions?.length ? d.definitions : ['']);
      setBengali(d.bengali?.length ? d.bengali : ['']);
      setSynonyms((d.synonyms || []).join(', '));
      setAntonyms((d.antonyms || []).join(', '));
      setExamples(d.examples?.length ? d.examples : ['']);
    }).catch(e => toast.error(e.message));
  }, [initialWord]);

  const autoFill = async () => {
    const w = word.trim().toLowerCase();
    if (!w) return toast.error('Enter a word first');
    setFilling(true);
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
      if (!res.ok) throw new Error('Word not found in dictionary API');
      const data = await res.json();
      const raw  = data[0];
      const defs = [], syns = [], ants = [], exs = [];
      for (const m of raw.meanings || []) {
        for (const d of m.definitions || []) {
          if (d.definition) defs.push(d.definition);
          if (d.example)    exs.push(d.example);
        }
        syns.push(...(m.synonyms || []));
        ants.push(...(m.antonyms || []));
      }
      setPhonetic(raw.phonetic || raw.phonetics?.[0]?.text || '');
      setDefinitions([...new Set(defs)].slice(0, 4) || ['']);
      setSynonyms([...new Set(syns)].slice(0, 8).join(', '));
      setAntonyms([...new Set(ants)].slice(0, 6).join(', '));
      setExamples([...new Set(exs)].slice(0, 3) || ['']);
      toast.success(`Auto-filled "${w}"!`);
    } catch (e) { toast.error(e.message); }
    finally { setFilling(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!word.trim()) return toast.error('Word is required');
    setLoading(true);
    try {
      await api.saveWord({
        word:        word.trim().toLowerCase(),
        phonetic:    phonetic.trim(),
        definitions: definitions.filter(Boolean),
        bengali:     bengali.filter(Boolean),
        synonyms:    synonyms.split(',').map(s => s.trim()).filter(Boolean),
        antonyms:    antonyms.split(',').map(s => s.trim()).filter(Boolean),
        examples:    examples.filter(Boolean),
      });
      toast.success(`"${word}" saved!`);
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-bold text-slate-900">{isEdit ? `Edit: ${initialWord}` : 'Add New Word'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>

        <form onSubmit={save} className="px-6 py-5 space-y-4">
          {/* Word + auto-fill */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="field-label">Word *</label>
              <input value={word} onChange={e => setWord(e.target.value)} readOnly={isEdit} required placeholder="e.g. ephemeral"
                className="w-full mt-1 text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-brand-400 bg-slate-50 focus:bg-white transition-all disabled:opacity-60" />
            </div>
            <div className="flex-1">
              <label className="field-label">Phonetic</label>
              <input value={phonetic} onChange={e => setPhonetic(e.target.value)} placeholder="/ɪˈfɛm.ər.əl/"
                className="w-full mt-1 text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-brand-400 bg-slate-50 focus:bg-white transition-all" />
            </div>
          </div>

          <button type="button" onClick={autoFill} disabled={filling} className="flex items-center gap-2 text-xs font-semibold text-brand-500 hover:text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors">
            {filling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Auto-fill from Free Dictionary API
          </button>

          <div><label className="field-label">Definitions</label><div className="mt-1"><DynamicList items={definitions} onChange={setDefinitions} placeholder="Enter definition…" /></div></div>
          <div><label className="field-label">Bengali Translations (বাংলা)</label><div className="mt-1"><DynamicList items={bengali} onChange={setBengali} placeholder="Bengali translation…" /></div></div>
          <div><label className="field-label">Example Sentences</label><div className="mt-1"><DynamicList items={examples} onChange={setExamples} placeholder="Example sentence…" /></div></div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="field-label">Synonyms (comma-separated)</label><input value={synonyms} onChange={e => setSynonyms(e.target.value)} placeholder="transient, fleeting…" className="w-full mt-1 text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-brand-400 bg-slate-50 focus:bg-white transition-all" /></div>
            <div><label className="field-label">Antonyms (comma-separated)</label><input value={antonyms} onChange={e => setAntonyms(e.target.value)} placeholder="permanent, eternal…" className="w-full mt-1 text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-brand-400 bg-slate-50 focus:bg-white transition-all" /></div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="px-5 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-60 rounded-xl transition-colors flex items-center gap-2">
              {loading ? <><Loader2 size={14} className="animate-spin" />Saving…</> : 'Save Word'}
            </button>
          </div>
        </form>
      </div>

      <style>{`.field-label{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em}`}</style>
    </div>
  );
}

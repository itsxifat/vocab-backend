import { useState, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check, ExternalLink, Shield, Key, Globe, Languages, Smartphone, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';

// ── Field components ──────────────────────────────────────────────────────────
function SecretField({ label, envKey, value, hint, link }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</label>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600">
            Get key <ExternalLink size={11} />
          </a>
        )}
      </div>
      <div className="relative">
        <input
          readOnly
          type={show ? 'text' : 'password'}
          value={value || ''}
          placeholder={value ? undefined : `Set ${envKey} in .env`}
          className="w-full text-sm px-3 py-2.5 pr-20 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 placeholder-slate-300 font-mono outline-none select-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button onClick={() => setShow(s => !s)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors">
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button onClick={copy} disabled={!value}
            className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded-lg transition-colors">
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
        </div>
      </div>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0 w-40">{label}</span>
      <span className={`text-xs font-semibold text-slate-700 text-right ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, color = 'bg-brand-500' }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={15} className="text-white" />
        </div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

// ── Env values injected at build-time (Vite exposes VITE_* vars only) ─────────
// We can't expose server secrets to the browser. Instead we show what's
// configured by reading a small status endpoint, or just show the .env keys.
// The real secret values are NEVER sent to the browser — we just show presence.
const envStatus = {
  APP_API_KEY:          import.meta.env.VITE_APP_API_KEY_SET     === 'true',
  MERRIAM_WEBSTER_KEY:  import.meta.env.VITE_MW_KEY_SET          === 'true',
  WORDNIK_KEY:          import.meta.env.VITE_WORDNIK_KEY_SET     === 'true',
  GOOGLE_TRANSLATE_KEY: import.meta.env.VITE_GOOGLE_KEY_SET      === 'true',
  MYMEMORY_EMAIL:       import.meta.env.VITE_MYMEMORY_EMAIL_SET  === 'true',
};

function ConfiguredBadge({ set }) {
  return set
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><Check size={10} /> Configured</span>
    : <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Not set</span>;
}

// ── Editable API key section ──────────────────────────────────────────────────
function ApiKeyEditor() {
  const KEYS = [
    {
      id: 'MERRIAM_WEBSTER_KEY',
      label: 'Merriam-Webster API Key',
      hint: 'Free tier: 1,000 req/day. Adds richer definitions.',
      link: 'https://dictionaryapi.com/register/index',
    },
    {
      id: 'WORDNIK_KEY',
      label: 'Wordnik API Key',
      hint: 'Adds extra definitions and example sentences.',
      link: 'https://developer.wordnik.com',
    },
    {
      id: 'GOOGLE_TRANSLATE_KEY',
      label: 'Google Translate API Key',
      hint: 'Paid — $20/M chars. Falls back to MyMemory if not set.',
      link: 'https://cloud.google.com/translate/docs/setup',
    },
    {
      id: 'MYMEMORY_EMAIL',
      label: 'MyMemory Email',
      hint: 'Free translation fallback. Your email doubles the free daily limit.',
    },
  ];

  const [status,  setStatus]  = useState({});  // { KEY: { set: bool } }
  const [values,  setValues]  = useState({});   // { KEY: string }
  const [saving,  setSaving]  = useState({});   // { KEY: bool }
  const [showing, setShowing] = useState({});   // { KEY: bool }

  useEffect(() => {
    api.getSettings().then(setStatus).catch(() => {});
  }, []);

  const save = async (key) => {
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const r = await api.setSetting(key, values[key] || '');
      setStatus(s => ({ ...s, [key]: { set: r.set } }));
      setValues(v => ({ ...v, [key]: '' }));
      toast.success(r.set ? `${key} saved` : `${key} cleared`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500">
          <Key size={15} className="text-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Dictionary API Keys</h2>
          <p className="text-xs text-slate-400 mt-0.5">Keys are stored in the database and survive server restarts. Set a key to empty to remove it.</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-5">
        <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 leading-relaxed">
          After adding a new key, click <strong>"Re-fetch All"</strong> on the <a href="/admin/auto-fetch" className="text-brand-500 underline">Auto-Fetch</a> page to update existing words with data from the new API.
        </p>
        {KEYS.map(({ id, label, hint, link }) => (
          <div key={id}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-600">{label}</label>
              <div className="flex items-center gap-2">
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600">
                    Get key <ExternalLink size={10} />
                  </a>
                )}
                {status[id]?.set
                  ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ Configured</span>
                  : <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Not set</span>
                }
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showing[id] ? 'text' : 'password'}
                  value={values[id] || ''}
                  onChange={e => setValues(v => ({ ...v, [id]: e.target.value }))}
                  placeholder={status[id]?.set ? '••••••••  (leave blank to keep current)' : `Paste your ${id}`}
                  className="w-full text-sm px-3 py-2.5 pr-9 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 placeholder-slate-300 font-mono outline-none focus:border-brand-300 focus:bg-white transition-colors"
                  onKeyDown={e => e.key === 'Enter' && save(id)}
                />
                <button onClick={() => setShowing(s => ({ ...s, [id]: !s[id] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
                  {showing[id] ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                onClick={() => save(id)}
                disabled={saving[id]}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60 transition-colors flex-shrink-0">
                {saving[id] ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={13} />}
                Save
              </button>
            </div>
            {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-400 mt-0.5">API keys & environment configuration</p>
      </div>

      <div className="space-y-6">

        {/* Editable API Keys — shown first */}
        <ApiKeyEditor />

        {/* Security */}
        <Section icon={Shield} title="Security Keys" color="bg-brand-500">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 leading-relaxed">
            Secrets are set in <code className="bg-slate-200 px-1 rounded font-mono">backend/.env</code> and are never exposed to the browser.
            Configure them on your VPS before starting the server.
          </p>

          <EnvRow name="JWT_SECRET" status={true} hint="Secret used to sign admin JWTs. Use a long random string (32+ chars)." required />
          <EnvRow name="APP_API_KEY" status={envStatus.APP_API_KEY} hint="API key the mobile app sends via X-API-Key header to access /api/dictionary/*." required />
          <EnvRow name="ADMIN_EMAIL" hint="Admin login email (default: admin@localhost)." />
          <EnvRow name="ADMIN_PASSWORD" hint="Plain-text fallback. Use ADMIN_PASSWORD_HASH (bcrypt) in production." />
          <EnvRow name="ADMIN_PASSWORD_HASH" hint="Bcrypt hash of admin password. Run: npm run hash-pass" />
        </Section>

        {/* Translation */}
        <Section icon={Languages} title="Bengali Translation" color="bg-emerald-500">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 leading-relaxed">
            If no Google key is set, translation falls back to MyMemory (free, 5000 chars/day).
            Providing a <code className="bg-slate-200 px-1 rounded font-mono">MYMEMORY_EMAIL</code> raises the free limit to 10000 chars/day.
          </p>

          <EnvRow name="GOOGLE_TRANSLATE_KEY" status={envStatus.GOOGLE_TRANSLATE_KEY}
            hint="Google Cloud Translation API key. Paid — $20 per million characters."
            link="https://cloud.google.com/translate/docs/setup" />
          <EnvRow name="MYMEMORY_EMAIL" status={envStatus.MYMEMORY_EMAIL}
            hint="Free fallback. Your email doubles the daily free limit to 10k chars." />
        </Section>

        {/* Mobile App */}
        <Section icon={Smartphone} title="Mobile App Connection" color="bg-orange-500">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 leading-relaxed">
            The React Native app reads its API URL from <code className="bg-slate-200 px-1 rounded font-mono">src/utils/config.js</code>.
            Update <code className="bg-slate-200 px-1 rounded font-mono">API_BASE</code> to your VPS domain and set the
            same <code className="bg-slate-200 px-1 rounded font-mono">APP_API_KEY</code> in both the app and server .env.
          </p>

          <div className="divide-y divide-slate-50">
            <InfoRow label="Dev (Android emulator)" value="http://10.0.2.2:3000" mono />
            <InfoRow label="Dev (iOS simulator)"    value="http://localhost:3000"  mono />
            <InfoRow label="Dev (physical device)"  value="http://192.168.x.x:3000 — run ipconfig" mono />
            <InfoRow label="Production"             value="https://your-domain.com" mono />
            <InfoRow label="Auth header"            value="X-API-Key: <APP_API_KEY>" mono />
            <InfoRow label="Sync endpoint"          value="GET /api/dictionary/sync?page=N" mono />
            <InfoRow label="Manifest endpoint"      value="GET /api/dictionary/manifest" mono />
          </div>
        </Section>

        {/* Server */}
        <Section icon={Globe} title="Server & CORS" color="bg-slate-600">
          <EnvRow name="MONGODB_URI"    hint="MongoDB connection string. Local: mongodb://localhost:27017/vocab" required />
          <EnvRow name="PORT"           hint="HTTP port (default: 3000). Usually behind nginx on 80/443." />
          <EnvRow name="CORS_ORIGINS"   hint="Comma-separated allowed origins for the API. e.g. https://yourapp.com" />
          <EnvRow name="BLOCKED_IPS"    hint="Comma-separated IPs to block at middleware level." />
          <EnvRow name="FETCH_CONCURRENCY" hint="Default concurrent requests for auto-fetch jobs (default: 5)." />
        </Section>

      </div>
    </div>
  );
}

// ── Single .env variable row ───────────────────────────────────────────────────
function EnvRow({ name, status, hint, link, required }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{name}</code>
          {required && <span className="text-xs text-red-400">required</span>}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-xs text-brand-500 hover:text-brand-600">
              docs <ExternalLink size={10} />
            </a>
          )}
        </div>
        {hint && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{hint}</p>}
      </div>
      {status !== undefined && <ConfiguredBadge set={status} />}
    </div>
  );
}

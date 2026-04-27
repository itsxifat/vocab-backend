const TOKEN_KEY = 'vocab_admin_token';

export const getToken   = ()  => localStorage.getItem(TOKEN_KEY);
export const setToken   = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = ()  => localStorage.removeItem(TOKEN_KEY);

async function request(url, opts = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // Network-level failure (server down, no proxy, connection refused)
    const err = new Error(`Cannot reach server — is the backend running? (${url.split('?')[0]})`);
    err.network = true;
    err.original = e.message;
    console.error('[api] network error:', url, e.message);
    throw err;
  }

  if (res.status === 401) { clearToken(); window.location.href = '/login'; return; }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err  = new Error(body.error || `HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.url    = url;
    err.body   = body;
    console.error(`[api] ${res.status} ${url}`, body);
    throw err;
  }
  return res.json();
}

export const api = {
  get:    (url)        => request(url),
  post:   (url, body)  => request(url, { method: 'POST',   body }),
  put:    (url, body)  => request(url, { method: 'PUT',    body }),
  delete: (url)        => request(url, { method: 'DELETE' }),

  // Health
  health: () => request('/admin/api/health'),

  // Auth
  login: (email, password) => request('/admin/api/auth/login', { method: 'POST', body: { email, password } }),

  // Stats
  stats: () => api.get('/admin/api/stats'),

  // Words
  words:      (page = 1, q = '') => api.get(`/admin/api/words?page=${page}&q=${encodeURIComponent(q)}&limit=20`),
  word:       (word)             => api.get(`/admin/api/words/${encodeURIComponent(word)}`),
  saveWord:   (body)             => api.post('/admin/api/words', body),
  deleteWord: (word)             => api.delete(`/admin/api/words/${encodeURIComponent(word)}`),

  // Auto-fetch
  wordlistInfo: ()    => api.get('/admin/api/autofetch/wordlist-info'),
  startFetch:   (cfg) => api.post('/admin/api/autofetch/start', cfg),
  stopFetch:    ()    => api.post('/admin/api/autofetch/stop', {}),
  fetchJobs:    ()    => api.get('/admin/api/autofetch/jobs'),

  // Word queue
  queueStats:        ()          => api.get('/admin/api/queue/stats'),
  queueAdd:          (words)     => api.post('/admin/api/queue/add', { words }),
  queueResetFailed:  ()          => api.post('/admin/api/queue/reset-failed', {}),
  queueResetAll:     ()          => api.post('/admin/api/queue/reset-all', {}),
  queueClear:        ()          => api.delete('/admin/api/queue'),

  // API key settings
  getSettings: ()          => api.get('/admin/api/settings'),
  setSetting:  (key, value) => api.post('/admin/api/settings', { key, value }),

  // Import / Export
  importWords: (words)  => api.post('/admin/api/import', { words }),
  exportUrl:   ()       => '/admin/api/export',

  // Wiktionary import
  wiktionaryJobs:       ()      => api.get('/admin/api/wiktionary/jobs'),
  wiktionaryStop:       ()      => api.post('/admin/api/wiktionary/stop', {}),
  stopWiktionaryJob:    (jobId) => api.post('/admin/api/wiktionary/stop', { jobId }),
  deleteWiktionaryJob:  (jobId) => api.delete(`/admin/api/wiktionary/jobs/${encodeURIComponent(jobId)}`),
  deleteWiktionaryFile: (jobId) => api.delete(`/admin/api/wiktionary/jobs/${encodeURIComponent(jobId)}/file`),
  recentWords:          (n=20)  => api.get(`/admin/api/words?sort=recent&limit=${n}&page=1`),
};

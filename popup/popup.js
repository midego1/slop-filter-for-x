/**
 * Popup logic. Renders settings/queue/history from chrome.storage.local and
 * delegates any block/mute action back to the content script running on the
 * active x.com tab (the popup has no cookies of its own to act with).
 */
(function () {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    highlightThreshold: 40,
    actionThreshold: 65,
    mode: 'queue', // 'highlight' | 'queue' | 'auto'
    action: 'block', // 'block' | 'mute'
    collapse: false,
    allowlist: [],
    maxActionsPerHour: 15,
    listUrls: [],
    listMode: 'highlight' // 'highlight' | 'queue' | 'auto'
  };

  const STATS_DEFAULTS = { scanned: 0, flagged: 0, acted: 0 };

  const state = {
    settings: { ...DEFAULTS },
    stats: { ...STATS_DEFAULTS },
    queue: [],
    log: [],
    listMeta: {}
  };

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ dom */

  const els = {
    enabled: $('enabled'),
    mode: $('mode'),
    action: $('action'),
    highlightThreshold: $('highlightThreshold'),
    actionThreshold: $('actionThreshold'),
    maxActionsPerHour: $('maxActionsPerHour'),
    hlVal: $('hl-val'),
    acVal: $('ac-val'),
    rlVal: $('rl-val'),
    collapse: $('collapse'),
    allowlist: $('allowlist'),
    autoNote: $('auto-note'),
    listMode: $('listMode'),
    listUrls: $('listUrls'),
    refreshLists: $('refresh-lists'),
    listStatus: $('list-status'),
    exportList: $('export-list'),
    statScanned: $('stat-scanned'),
    statFlagged: $('stat-flagged'),
    statActed: $('stat-acted'),
    queueCount: $('queue-count'),
    queueList: $('queue-list'),
    queueEmpty: $('queue-empty'),
    queueAll: $('queue-all'),
    queueClear: $('queue-clear'),
    logList: $('log-list'),
    logEmpty: $('log-empty'),
    status: $('status'),
    health: $('health'),
    healthText: $('health-text'),
    updateNote: $('update-note'),
    updateText: $('update-text'),
    tabButtons: [...document.querySelectorAll('nav.tabs button[data-tab]')]
  };

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setStatus(msg) {
    els.status.textContent = msg || '';
  }

  function setValue(el, val) {
    if (document.activeElement === el) return;
    el.value = val;
  }

  function setChecked(el, val) {
    if (document.activeElement === el) return;
    el.checked = !!val;
  }

  function relTime(ts) {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  /* -------------------------------------------------------------- tabs ui */

  function switchTab(name) {
    els.tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    ['settings', 'queue', 'log'].forEach((t) => {
      const section = $('tab-' + t);
      if (section) section.hidden = t !== name;
    });
  }

  els.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ---------------------------------------------------------- settings ui */

  function updateAutoNote() {
    els.autoNote.hidden = state.settings.mode !== 'auto';
  }

  function renderSettingsUI() {
    setChecked(els.enabled, state.settings.enabled);
    setValue(els.mode, state.settings.mode);
    setValue(els.action, state.settings.action);
    setValue(els.highlightThreshold, state.settings.highlightThreshold);
    els.hlVal.textContent = String(state.settings.highlightThreshold);
    setValue(els.actionThreshold, state.settings.actionThreshold);
    els.acVal.textContent = String(state.settings.actionThreshold);
    setValue(els.maxActionsPerHour, state.settings.maxActionsPerHour);
    els.rlVal.textContent = String(state.settings.maxActionsPerHour);
    setChecked(els.collapse, state.settings.collapse);
    if (document.activeElement !== els.allowlist) {
      els.allowlist.value = (state.settings.allowlist || []).join('\n');
    }
    setValue(els.listMode, state.settings.listMode);
    if (document.activeElement !== els.listUrls) {
      els.listUrls.value = (state.settings.listUrls || []).join('\n');
    }
    updateAutoNote();
    renderListStatus();
  }

  function renderListStatus() {
    const meta = state.listMeta || {};
    const parts = (state.settings.listUrls || []).map((url) => {
      const m = meta[url];
      if (!m) return null;
      return m.error ? `${shortUrl(url)}: ${m.error}` : `${m.name}: ${m.count} accounts`;
    });
    els.listStatus.textContent = parts.filter(Boolean).join(' · ');
  }

  function shortUrl(url) {
    try {
      return new URL(url).pathname.split('/').pop() || url;
    } catch {
      return url;
    }
  }

  function renderStatsUI() {
    els.statScanned.textContent = String(state.stats.scanned || 0);
    els.statFlagged.textContent = String(state.stats.flagged || 0);
    els.statActed.textContent = String(state.stats.acted || 0);
  }

  function saveSettings() {
    chrome.storage.local.set({ settings: state.settings });
  }

  els.enabled.addEventListener('change', () => {
    state.settings.enabled = els.enabled.checked;
    saveSettings();
  });

  els.mode.addEventListener('change', () => {
    state.settings.mode = els.mode.value;
    saveSettings();
    updateAutoNote();
  });

  els.action.addEventListener('change', () => {
    state.settings.action = els.action.value;
    saveSettings();
    renderQueue();
  });

  els.highlightThreshold.addEventListener('input', () => {
    els.hlVal.textContent = els.highlightThreshold.value;
  });
  els.highlightThreshold.addEventListener('change', () => {
    state.settings.highlightThreshold = Number(els.highlightThreshold.value);
    saveSettings();
  });

  els.actionThreshold.addEventListener('input', () => {
    els.acVal.textContent = els.actionThreshold.value;
  });
  els.actionThreshold.addEventListener('change', () => {
    state.settings.actionThreshold = Number(els.actionThreshold.value);
    saveSettings();
  });

  els.maxActionsPerHour.addEventListener('input', () => {
    els.rlVal.textContent = els.maxActionsPerHour.value;
  });
  els.maxActionsPerHour.addEventListener('change', () => {
    state.settings.maxActionsPerHour = Number(els.maxActionsPerHour.value);
    saveSettings();
  });

  els.collapse.addEventListener('change', () => {
    state.settings.collapse = els.collapse.checked;
    saveSettings();
  });

  let allowlistTimer = null;
  function flushAllowlist() {
    clearTimeout(allowlistTimer);
    allowlistTimer = null;
    const lines = els.allowlist.value
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    state.settings.allowlist = [...new Set(lines)];
    saveSettings();
  }
  els.allowlist.addEventListener('input', () => {
    clearTimeout(allowlistTimer);
    allowlistTimer = setTimeout(flushAllowlist, 400);
  });
  els.allowlist.addEventListener('change', flushAllowlist);

  els.listMode.addEventListener('change', () => {
    state.settings.listMode = els.listMode.value;
    saveSettings();
  });

  let listUrlsTimer = null;
  function flushListUrls() {
    clearTimeout(listUrlsTimer);
    listUrlsTimer = null;
    const lines = els.listUrls.value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^https:\/\//.test(s));
    state.settings.listUrls = [...new Set(lines)];
    saveSettings();
  }
  els.listUrls.addEventListener('input', () => {
    clearTimeout(listUrlsTimer);
    listUrlsTimer = setTimeout(flushListUrls, 400);
  });
  els.listUrls.addEventListener('change', flushListUrls);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (allowlistTimer) flushAllowlist();
    if (listUrlsTimer) flushListUrls();
  });

  els.refreshLists.addEventListener('click', () => {
    els.refreshLists.disabled = true;
    setStatus('Refreshing lists…');
    chrome.runtime.sendMessage({ type: 'slopf-refresh-lists' }, (resp) => {
      els.refreshLists.disabled = false;
      setStatus(resp && resp.ok ? 'Lists refreshed' : (resp && resp.error) || 'Refresh failed');
    });
  });

  /* -------------------------------------------------------------- health */

  function setHealth(state, text) {
    els.health.dataset.state = state; // 'ok' | 'bad' | 'off'
    els.healthText.textContent = text;
  }

  function isNewer(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  function renderUpdateNote(info) {
    // Compare against the popup's own runtime version — authoritative for
    // "what am I running", even if the background cached an older check.
    const current = chrome.runtime.getManifest().version;
    if (!info || !info.latest || !isNewer(info.latest, current)) {
      els.updateNote.hidden = true;
      return;
    }
    els.updateText.textContent = `Update available: v${info.latest} (you run v${current}) — git pull, then ↻ the extension.`;
    els.updateNote.hidden = false;
  }

  async function checkHealth() {
    const tab = await findXTab();
    if (!tab) {
      setHealth('off', 'No x.com tab open');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'slopf-ping' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        setHealth(
          'bad',
          'Not running on the open x.com tab — reload the tab; if it persists, check chrome://extensions'
        );
        return;
      }
      setHealth(
        'ok',
        `Active on x.com · v${resp.version} · ${resp.enabled ? resp.mode + ' mode' : 'disabled'}`
      );
    });
  }

  /* --------------------------------------------------------- x.com bridge */

  function findXTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (tabs) => {
        if (!tabs || !tabs.length) {
          resolve(null);
          return;
        }
        resolve(tabs.find((t) => t.active) || tabs[0]);
      });
    });
  }

  async function sendAct(handle, action) {
    const tab = await findXTab();
    if (!tab) throw new Error('Open x.com in a tab to act on accounts');

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'slopf-act', action, handle }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error((resp && resp.error) || 'Unknown error'));
          return;
        }
        resolve();
      });
    });
  }

  /* ------------------------------------------------------------- queue ui */

  function persistQueueLogStats() {
    chrome.storage.local.set({ queue: state.queue, log: state.log, stats: state.stats });
  }

  async function actOnEntry(entry) {
    setStatus('');
    try {
      await sendAct(entry.handle, state.settings.action);

      state.queue = state.queue.filter((q) => q.handle !== entry.handle);
      state.log = [
        {
          handle: entry.handle,
          displayName: entry.displayName,
          action: state.settings.action,
          trigger: 'queue',
          score: entry.score,
          reasons: entry.reasons,
          tags: entry.tags || [],
          url: entry.url,
          ts: Date.now()
        },
        ...state.log
      ].slice(0, 500);
      state.stats = { ...state.stats, acted: (state.stats.acted || 0) + 1 };

      persistQueueLogStats();
      renderQueue();
      renderLog();
      renderStatsUI();
      return true;
    } catch (err) {
      setStatus(String((err && err.message) || err));
      return false;
    }
  }

  function dismissEntry(entry) {
    state.queue = state.queue.filter((q) => q.handle !== entry.handle);
    const list = new Set(state.settings.allowlist || []);
    list.add(entry.handle.toLowerCase());
    state.settings.allowlist = [...list];
    chrome.storage.local.set({ queue: state.queue, settings: state.settings });
    renderQueue();
    renderSettingsUI();
  }

  async function actOnAllQueued() {
    const entries = [...state.queue];
    els.queueAll.disabled = true;
    try {
      for (const entry of entries) {
        if (!state.queue.some((q) => q.handle === entry.handle)) continue;
        const ok = await actOnEntry(entry);
        if (!ok) break;
      }
    } finally {
      els.queueAll.disabled = false;
    }
  }

  function clearQueue() {
    state.queue = [];
    chrome.storage.local.set({ queue: [] });
    renderQueue();
  }

  els.queueAll.addEventListener('click', () => actOnAllQueued());
  els.queueClear.addEventListener('click', () => clearQueue());

  function buildQueueItem(entry) {
    const li = document.createElement('li');

    const row = document.createElement('div');
    row.className = 'row';

    const link = document.createElement('a');
    link.className = 'handle';
    link.href = entry.url || `https://x.com/${entry.handle}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '@' + entry.handle;

    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = String(entry.score);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = relTime(entry.ts);

    row.append(link, score, time);

    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = (entry.reasons || []).join(' · ');

    const excerpt = document.createElement('div');
    excerpt.className = 'excerpt';
    excerpt.textContent = entry.excerpt || '';

    const acts = document.createElement('div');
    acts.className = 'acts';

    const actBtn = document.createElement('button');
    actBtn.textContent = state.settings.action === 'mute' ? 'Mute' : 'Block';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'secondary';
    dismissBtn.textContent = 'Dismiss';

    actBtn.addEventListener('click', async () => {
      actBtn.disabled = true;
      dismissBtn.disabled = true;
      const ok = await actOnEntry(entry);
      if (!ok) {
        actBtn.disabled = false;
        dismissBtn.disabled = false;
      }
    });

    dismissBtn.addEventListener('click', () => dismissEntry(entry));

    acts.append(actBtn, dismissBtn);
    li.append(row, why, excerpt, acts);
    return li;
  }

  function renderQueue() {
    clearChildren(els.queueList);
    const queue = state.queue || [];
    els.queueEmpty.hidden = queue.length !== 0;
    queue.forEach((entry) => els.queueList.appendChild(buildQueueItem(entry)));
    updateQueuePill();
  }

  function updateQueuePill() {
    els.queueCount.textContent = String((state.queue || []).length);
  }

  /* --------------------------------------------------------- history ui */

  function buildLogItem(entry) {
    const li = document.createElement('li');

    const row = document.createElement('div');
    row.className = 'row';

    const handleEl = document.createElement(entry.url ? 'a' : 'span');
    handleEl.className = 'handle';
    if (entry.url) {
      handleEl.href = entry.url;
      handleEl.target = '_blank';
      handleEl.rel = 'noopener noreferrer';
    }
    handleEl.textContent = '@' + entry.handle;

    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = String(entry.score);

    row.append(handleEl, score);

    const why = document.createElement('div');
    why.className = 'why';
    const actionLabel = entry.action === 'mute' ? 'Muted' : 'Blocked';
    why.textContent = `${actionLabel} · ${entry.trigger || ''} · ${relTime(entry.ts)}`;

    li.append(row, why);
    return li;
  }

  function renderLog() {
    clearChildren(els.logList);
    const log = state.log || [];
    els.logEmpty.hidden = log.length !== 0;
    log.forEach((entry) => els.logList.appendChild(buildLogItem(entry)));
  }

  /* -------------------------------------------------------------- export */

  function getReporterId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['reporterId'], (d) => {
        if (d.reporterId) return resolve(d.reporterId);
        const id = crypto.randomUUID();
        chrome.storage.local.set({ reporterId: id }, () => resolve(id));
      });
    });
  }

  async function exportList() {
    const byHandle = new Map();
    for (const e of state.log) {
      if (!e || !e.handle) continue;
      const key = e.handle.toLowerCase();
      const cur =
        byHandle.get(key) || {
          handle: e.handle,
          tags: new Set(),
          score: 0,
          evidence: new Set(),
          first_seen: e.ts,
          action: e.action
        };
      (e.tags && e.tags.length ? e.tags : ['ai-slop']).forEach((t) => cur.tags.add(t));
      cur.score = Math.max(cur.score, e.score || 0);
      if (e.url) cur.evidence.add(e.url);
      cur.first_seen = Math.min(cur.first_seen, e.ts);
      byHandle.set(key, cur);
    }

    const doc = {
      format: 'slop-list/1',
      name: 'personal export',
      exported: new Date().toISOString(),
      reporter: await getReporterId(),
      entries: [...byHandle.values()].map((e) => ({
        handle: e.handle,
        tags: [...e.tags],
        score: e.score,
        action: e.action,
        evidence: [...e.evidence].slice(0, 3),
        first_seen: new Date(e.first_seen).toISOString()
      })),
      // Local allowlist doubles as counter-evidence: "I looked, it's a human."
      not_slop: state.settings.allowlist || []
    };

    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slop-list-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${doc.entries.length} accounts`);
  }

  els.exportList.addEventListener('click', () => exportList());

  /* ------------------------------------------------------------- storage */

  function renderAll() {
    renderSettingsUI();
    renderStatsUI();
    renderQueue();
    renderLog();
  }

  function loadAll() {
    chrome.storage.local.get(['settings', 'stats', 'queue', 'log', 'listMeta', 'updateInfo'], (d) => {
      state.settings = { ...DEFAULTS, ...(d.settings || {}) };
      state.stats = { ...STATS_DEFAULTS, ...(d.stats || {}) };
      state.queue = d.queue || [];
      state.log = d.log || [];
      state.listMeta = d.listMeta || {};
      renderAll();
      renderUpdateNote(d.updateInfo);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      state.settings = { ...DEFAULTS, ...changes.settings.newValue };
      renderSettingsUI();
    }
    if (changes.stats) {
      state.stats = { ...STATS_DEFAULTS, ...changes.stats.newValue };
      renderStatsUI();
    }
    if (changes.queue) {
      state.queue = changes.queue.newValue || [];
      renderQueue();
    }
    if (changes.log) {
      state.log = changes.log.newValue || [];
      renderLog();
    }
    if (changes.listMeta) {
      state.listMeta = changes.listMeta.newValue || {};
      renderListStatus();
    }
    if (changes.updateInfo) {
      renderUpdateNote(changes.updateInfo.newValue);
    }
  });

  loadAll();
  checkHealth();
})();

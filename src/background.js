/**
 * Service worker: keeps subscribed community lists fresh.
 *
 * Fetches every URL in settings.listUrls (restricted to GitHub raw/gist/pages
 * so the extension can't be pointed at arbitrary endpoints), validates the
 * slop-list/1 format, and stores a flat handle→{tags, lists} index that the
 * content script checks on every tweet.
 */
'use strict';

const REFRESH_MINUTES = 360;
const MAX_ENTRIES_PER_LIST = 50000;
const ALLOWED_HOSTS = ['raw.githubusercontent.com', 'gist.githubusercontent.com'];

function hostAllowed(u) {
  return ALLOWED_HOSTS.includes(u.hostname) || u.hostname.endsWith('.github.io');
}

async function refreshLists() {
  const { settings } = await chrome.storage.local.get(['settings']);
  const urls = (settings && settings.listUrls) || [];
  const index = {};
  const meta = {};

  for (const url of urls) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') throw new Error('https only');
      if (!hostAllowed(u)) throw new Error('host not allowed (GitHub raw/gist/pages only)');

      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.format !== 'slop-list/1' || !Array.isArray(data.entries)) {
        throw new Error('not a slop-list/1 file');
      }

      const name = String(data.name || u.pathname.split('/').pop() || 'unnamed list').slice(0, 40);
      let count = 0;

      for (const e of data.entries.slice(0, MAX_ENTRIES_PER_LIST)) {
        if (!e || typeof e.handle !== 'string') continue;
        const h = e.handle.replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{1,15}$/.test(h)) continue;

        const cur = index[h] || { tags: [], lists: [] };
        const tags = Array.isArray(e.tags)
          ? e.tags.filter((t) => typeof t === 'string').map((t) => t.slice(0, 24)).slice(0, 6)
          : [];
        cur.tags = [...new Set([...cur.tags, ...tags])];
        if (!cur.lists.includes(name)) cur.lists.push(name);
        index[h] = cur;
        count++;
      }

      meta[url] = { name, count, fetchedAt: Date.now() };
    } catch (err) {
      meta[url] = { error: String((err && err.message) || err), fetchedAt: Date.now() };
    }
  }

  await chrome.storage.local.set({ listIndex: index, listMeta: meta });
}

/* ------------------------------------------------------------ update check */

const REPO_MANIFEST = 'https://raw.githubusercontent.com/midego1/slop-filter-for-x/main/manifest.json';
const UPDATE_CHECK_MINUTES = 720; // twice a day

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

async function checkForUpdate() {
  try {
    const res = await fetch(REPO_MANIFEST, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    const latest = String(remote.version || '');
    if (!/^\d+(\.\d+)*$/.test(latest)) throw new Error('bad remote version');
    const current = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({
      updateInfo: { latest, current, updateAvailable: isNewer(latest, current), checkedAt: Date.now() }
    });
  } catch {
    // Keep the last known info; never block anything on a failed check.
  }
}

/* ----------------------------------------------------------------- wiring */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('slopf-refresh', { periodInMinutes: REFRESH_MINUTES, delayInMinutes: 1 });
  chrome.alarms.create('slopf-update-check', { periodInMinutes: UPDATE_CHECK_MINUTES, delayInMinutes: 2 });
  refreshLists();
  checkForUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  refreshLists();
  checkForUpdate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'slopf-refresh') refreshLists();
  if (alarm.name === 'slopf-update-check') checkForUpdate();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.type !== 'slopf-refresh-lists') return;
  refreshLists()
    .then(() => respond({ ok: true }))
    .catch((err) => respond({ ok: false, error: String((err && err.message) || err) }));
  return true; // async response
});

// Re-fetch when the subscription list itself changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = JSON.stringify((changes.settings.oldValue || {}).listUrls || []);
  const after = JSON.stringify((changes.settings.newValue || {}).listUrls || []);
  if (before !== after) refreshLists();
});

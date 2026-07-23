/**
 * Timeline scanner. Walks tweets as X renders them, scores each one, decorates
 * the flagged ones, and — depending on the configured mode — either queues the
 * author for review or acts on them directly.
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

  let settings = { ...DEFAULTS };
  let listIndex = {}; // handleLower -> {tags, lists}, maintained by background.js
  const seen = new WeakSet();
  const counted = new WeakSet(); // articles already counted into scanned/flagged stats
  const actedOn = new Set(); // handles handled this page session
  let ownHandle = null;

  /* ---------------------------------------------------------------- storage */

  // Serializes every storage read-modify-write so concurrent calls during a
  // scan burst can't clobber each other's writes.
  let storeChain = Promise.resolve();
  function withStore(fn) {
    storeChain = storeChain.then(fn, fn);
    return storeChain;
  }

  const load = () =>
    new Promise((r) =>
      chrome.storage.local.get(['settings', 'listIndex'], (d) => {
        settings = { ...DEFAULTS, ...(d.settings || {}) };
        listIndex = d.listIndex || {};
        r();
      })
    );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULTS, ...changes.settings.newValue };
      rescan();
    }
    if (changes.listIndex) {
      listIndex = changes.listIndex.newValue || {};
      rescan();
    }
  });

  function bump(field, n = 1) {
    return withStore(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['stats'], (d) => {
            const stats = d.stats || { scanned: 0, flagged: 0, acted: 0 };
            stats[field] = (stats[field] || 0) + n;
            chrome.storage.local.set({ stats }, resolve);
          });
        })
    );
  }

  function pushQueue(entry) {
    return withStore(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['queue'], (d) => {
            const queue = d.queue || [];
            if (queue.some((q) => q.handle === entry.handle)) return resolve();
            queue.unshift(entry);
            chrome.storage.local.set({ queue: queue.slice(0, 200) }, resolve);
          });
        })
    );
  }

  function pushLog(entry) {
    return withStore(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['log'], (d) => {
            const log = d.log || [];
            log.unshift(entry);
            chrome.storage.local.set({ log: log.slice(0, 500) }, resolve);
          });
        })
    );
  }

  /** Simple token bucket so we never look like a bot to X's spam heuristics. */
  function withinRateLimit() {
    return withStore(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['actionTimes'], (d) => {
            const cutoff = Date.now() - 3600_000;
            const times = (d.actionTimes || []).filter((t) => t > cutoff);
            if (times.length >= settings.maxActionsPerHour) return resolve(false);
            times.push(Date.now());
            chrome.storage.local.set({ actionTimes: times }, () => resolve(true));
          });
        })
    );
  }

  /* ------------------------------------------------------------- extraction */

  function findOwnHandle() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (link) ownHandle = link.getAttribute('href').replace('/', '').toLowerCase();
  }

  function extract(article) {
    const nameBlock = article.querySelector('div[data-testid="User-Name"]');
    if (!nameBlock) return null;

    const handleLink = [...nameBlock.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute('href'))
      .find((h) => /^\/[A-Za-z0-9_]{1,15}$/.test(h));
    if (!handleLink) return null;

    const handle = handleLink.slice(1);
    const textNode = article.querySelector('div[data-testid="tweetText"]');
    const text = textNode ? textNode.innerText : '';
    const displayName = nameBlock.querySelector('span')?.innerText || handle;
    const permalink =
      article.querySelector('a[href*="/status/"]')?.getAttribute('href') || `/${handle}`;

    return { handle, displayName, text, url: `https://x.com${permalink}` };
  }

  /* --------------------------------------------------------------------- ui */

  // Floating corner chip: absolutely positioned so X's flex layout is never
  // disturbed. Collapsed to a small pill; click to expand reasons + actions.
  function decorate(article, tweet, result) {
    article.classList.add('slopf-flagged');
    article.dataset.slopfScore = String(result.score);
    const severity = result.listed
      ? 'listed'
      : result.score >= settings.actionThreshold
        ? 'severe'
        : 'mild';
    article.classList.add('slopf-' + severity);

    const chip = document.createElement('span');
    chip.className = 'slopf-chip';

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'slopf-pill';
    pill.textContent = result.listed ? '✦ listed' : `✦ ${result.score}`;
    pill.title = 'Flagged by Slop Filter — click for details';
    pill.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      article.classList.remove('slopf-collapsed');
      const opening = !chip.classList.contains('slopf-open');
      closeAllChips();
      if (opening) {
        chip.classList.add('slopf-open');
        // Portal the card to <body>: X's virtualized rows have CSS
        // transforms, which re-anchor position:fixed to the row instead of
        // the viewport. body has no transforms, so coordinates are true.
        const r = pill.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        document.body.appendChild(card);
        card.classList.add('slopf-card-open');
        // Right-align under the pill, dropdown-style.
        card.style.left = Math.max(8, Math.min(r.right - 250, vw - 258)) + 'px';
        card.style.top = Math.max(8, Math.min(r.bottom + 6, vh - 130)) + 'px';
        card._chip = chip;
        openCard = card;
      }
    };

    const card = document.createElement('div');
    card.className = 'slopf-card';
    card.onclick = (e) => e.stopPropagation(); // clicks inside shouldn't close it

    const why = document.createElement('div');
    why.className = 'slopf-why';
    why.textContent = result.reasons
      .slice(0, 4)
      .map((r) => (r.points ? `${r.label} +${r.points}` : r.label))
      .join(' · ');

    const actions = document.createElement('div');
    actions.className = 'slopf-actions';

    const act = document.createElement('button');
    act.type = 'button';
    act.textContent = settings.action === 'mute' ? `Mute @${tweet.handle}` : `Block @${tweet.handle}`;
    act.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      act.disabled = true;
      act.textContent = 'Working…';
      try {
        await performAction(tweet, result, 'manual');
        act.textContent = 'Done';
      } catch (err) {
        act.textContent = 'Failed';
        act.title = String(err.message || err);
        act.disabled = false;
      }
    };

    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.className = 'slopf-secondary';
    ignore.textContent = 'Not slop';
    ignore.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      allow(tweet.handle);
      closeAllChips(); // returns a body-portaled card to the chip first
      article.classList.remove('slopf-flagged', 'slopf-severe', 'slopf-mild', 'slopf-listed', 'slopf-collapsed');
      article.querySelector('.slopf-edge')?.remove();
      chip.remove();
    };

    actions.append(act, ignore);
    card.append(why, actions);
    chip.append(pill, card);

    // Anchored top-right, left of X's Grok/⋯ icons — a fixed zone in every
    // tweet variant, and absolute positioning never disturbs X's layout.
    article.append(chip);

    // Edge line as a real element in the same top layer as the chip — X's
    // hover background repaints over article-level box-shadows and
    // pseudo-elements, but not over this.
    const edge = document.createElement('span');
    edge.className = 'slopf-edge';
    article.append(edge);

    if (settings.collapse && severity === 'severe') {
      article.classList.add('slopf-collapsed');
    }
  }

  let openCard = null;

  function closeAllChips() {
    document.querySelectorAll('.slopf-chip.slopf-open').forEach((c) => c.classList.remove('slopf-open'));
    if (openCard) {
      openCard.classList.remove('slopf-card-open');
      // Return the card to its chip so Not-slop/rescan cleanup removes it too.
      if (openCard._chip) openCard._chip.append(openCard);
      openCard = null;
    }
  }

  document.addEventListener('scroll', closeAllChips, true);
  document.addEventListener('click', closeAllChips);

  function allow(handle) {
    return withStore(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['settings'], (d) => {
            const s = { ...DEFAULTS, ...(d.settings || {}) };
            const list = new Set(s.allowlist || []);
            list.add(handle.toLowerCase());
            s.allowlist = [...list];
            chrome.storage.local.set({ settings: s }, resolve);
          });
        })
    );
  }

  /* ---------------------------------------------------------------- actions */

  async function performAction(tweet, result, trigger) {
    const fn = settings.action === 'mute' ? SlopApi.mute : SlopApi.block;
    await fn(tweet.handle);
    actedOn.add(tweet.handle.toLowerCase());
    bump('acted');
    pushLog({
      handle: tweet.handle,
      displayName: tweet.displayName,
      action: settings.action,
      trigger,
      score: result.score,
      reasons: result.reasons.map((r) => r.label),
      tags: result.tags || SlopTags.fromReasons(result.reasons.map((r) => r.id)),
      url: tweet.url,
      ts: Date.now()
    });
  }

  /* ----------------------------------------------------------------- engine */

  async function process(article) {
    if (seen.has(article)) return;
    seen.add(article);
    if (!settings.enabled) return;

    const tweet = extract(article);
    if (!tweet) return;

    const lower = tweet.handle.toLowerCase();
    if (lower === ownHandle) return;
    if ((settings.allowlist || []).includes(lower)) return;

    const firstPass = !counted.has(article);
    if (firstPass) {
      counted.add(article);
      bump('scanned');
    }

    // A community-list hit trumps the detector: the account was already judged.
    const listHit = listIndex[lower];
    let result;
    if (listHit) {
      result = {
        score: 100,
        listed: true,
        tags: listHit.tags || [],
        reasons: [
          { id: 'listed', label: `On list: ${(listHit.lists || []).join(', ')}`, hits: 1, points: 100 },
          ...(listHit.tags || []).map((t) => ({ id: 'tag', label: t, hits: 1, points: 0 }))
        ]
      };
    } else {
      result = SlopDetector.score(tweet.text, { handle: tweet.handle });
      result.tags = SlopTags.fromReasons(result.reasons.map((r) => r.id));
      if (result.score < settings.highlightThreshold) return;
    }

    if (firstPass) bump('flagged');
    decorate(article, tweet, result);

    // List hits follow their own mode; detector hits need the action threshold.
    const mode = listHit ? settings.listMode : settings.mode;
    if (!listHit && result.score < settings.actionThreshold) return;
    if (mode === 'highlight') return;
    if (actedOn.has(lower)) return;

    if (mode === 'queue') {
      actedOn.add(lower);
      pushQueue({
        handle: tweet.handle,
        displayName: tweet.displayName,
        score: result.score,
        reasons: result.reasons.map((r) => r.label),
        tags: result.tags,
        source: listHit ? 'list' : 'detector',
        excerpt: tweet.text.slice(0, 240),
        url: tweet.url,
        ts: Date.now()
      });
    } else if (mode === 'auto') {
      if (!(await withinRateLimit())) return;
      actedOn.add(lower);
      try {
        await performAction(tweet, result, listHit ? 'list-auto' : 'auto');
        article.classList.add('slopf-acted');
      } catch (err) {
        console.warn('[slop-filter]', err);
        actedOn.delete(lower);
      }
    }
  }

  // The popup has no x.com cookies of its own, so it delegates the actual API
  // calls back to this content script.
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg && msg.type === 'slopf-ping') {
      respond({
        ok: true,
        version: chrome.runtime.getManifest().version,
        enabled: settings.enabled,
        mode: settings.mode
      });
      return;
    }
    if (!msg || msg.type !== 'slopf-act') return;
    const fn = SlopApi[msg.action];
    if (!fn) {
      respond({ ok: false, error: `Unknown action ${msg.action}` });
      return;
    }
    fn(msg.handle)
      .then(() => respond({ ok: true }))
      .catch((err) => respond({ ok: false, error: String(err.message || err) }));
    return true; // async response
  });

  function scan(root) {
    (root.querySelectorAll ? root.querySelectorAll('article[data-testid="tweet"]') : []).forEach(process);
    if (root.matches && root.matches('article[data-testid="tweet"]')) process(root);
  }

  function rescan() {
    closeAllChips();
    document.querySelectorAll('.slopf-chip, .slopf-edge').forEach((b) => b.remove());
    document
      .querySelectorAll('.slopf-flagged')
      .forEach((a) => a.classList.remove('slopf-flagged', 'slopf-severe', 'slopf-mild', 'slopf-collapsed', 'slopf-listed'));
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      seen.delete(a);
      process(a);
    });
  }

  async function init() {
    await load();
    findOwnHandle();
    scan(document);

    const obs = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1) scan(node);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // X is a SPA; the profile link only exists once the shell has mounted.
    if (!ownHandle) setTimeout(findOwnHandle, 3000);
  }

  init();
})();

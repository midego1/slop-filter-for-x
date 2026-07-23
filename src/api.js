/**
 * Thin wrapper over X's own web endpoints.
 *
 * We run inside a content script on x.com, so the session cookies are already
 * attached; we just have to mirror the headers the web client sends. This is
 * the same request your browser makes when you click "Block" in the UI — it is
 * not a public, documented API, so expect it to break when X reshuffles things.
 */
(function () {
  'use strict';

  // Public bearer shipped in X's own web bundle.
  const BEARER =
    'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? m[1] : null;
  }

  function headers() {
    const ct0 = csrfToken();
    if (!ct0) throw new Error('No ct0 cookie — are you signed in to X?');
    return {
      authorization: BEARER,
      'x-csrf-token': ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'content-type': 'application/x-www-form-urlencoded'
    };
  }

  async function post(path, params) {
    const res = await fetch(`https://${location.hostname}/i/api/1.1/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: headers(),
      body: new URLSearchParams(params).toString()
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`);
    }
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  self.SlopApi = {
    block: (screenName) => post('blocks/create.json', { screen_name: screenName }),
    unblock: (screenName) => post('blocks/destroy.json', { screen_name: screenName }),
    mute: (screenName) => post('mutes/users/create.json', { screen_name: screenName }),
    unmute: (screenName) => post('mutes/users/destroy.json', { screen_name: screenName })
  };
})();

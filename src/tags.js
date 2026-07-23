/**
 * Tag taxonomy shared by the content script (log entries) and the popup
 * (exports). Detector rule ids collapse into a small, stable set of tags so
 * exported lists stay comparable across versions even as rules evolve.
 */
(function () {
  'use strict';

  const MAP = {
    'leaked-assistant': 'llm-leak',
    'prompt-residue': 'llm-leak',
    'generic-praise': 'bot-reply',
    'engagement-bait': 'engagement-bait',
    listicle: 'engagement-bait',
    'hashtag-spam': 'spam',
    'invisible-chars': 'spam',
    'ai-disclosure': 'self-declared-ai'
  };

  // Everything not mapped above is a stylistic tell → generic 'ai-slop'.
  const TAGS = ['ai-slop', 'llm-leak', 'bot-reply', 'engagement-bait', 'spam', 'self-declared-ai'];

  function fromReasons(ids) {
    const tags = new Set();
    (ids || []).forEach((id) => tags.add(MAP[id] || 'ai-slop'));
    return [...tags];
  }

  self.SlopTags = { fromReasons, TAGS, MAP };
})();

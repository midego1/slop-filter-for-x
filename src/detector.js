/**
 * Slop detector — pure scoring, no DOM.
 *
 * Each rule returns a hit count (0 = no hit). Score is the weighted sum,
 * clamped to 100. Weights are tuned so that *one* strong tell (a leaked
 * assistant refusal, an emoji bullet deck) can carry a post on its own, while
 * the softer stylistic tells need to stack up before they mean anything.
 */
(function () {
  'use strict';

  const rx = (s, f) => new RegExp(s, f || 'gi');

  // Words that are fine in isolation and damning in a cluster.
  const LEXICON = [
    'delve', 'tapestry', 'testament to', 'ever-evolving', 'ever-changing',
    'fast-paced world', 'in today\'s', 'landscape of', 'realm of', 'unlock the',
    'harness the', 'leverage the power', 'seamless', 'robust solution',
    'game-changer', 'game changer', 'paradigm shift', 'navigate the complexities',
    'it\'s worth noting', 'at its core', 'the bottom line', 'crucial role',
    'pivotal', 'underscores', 'meticulous', 'a myriad of', 'plethora',
    'foster a', 'embark on', 'shed light on', 'dive deep', 'deep dive',
    'unpack', 'supercharge', 'skyrocket', 'ushering in', 'the future of work'
  ];

  const BAIT = [
    'let that sink in', 'read that again', 'bookmark this', 'save this post',
    'save this for later', 'follow for more', 'you\'re welcome',
    'most people don\'t know', 'nobody talks about this', 'no one is talking about',
    'here\'s the kicker', 'here\'s the thing', 'the result?', 'and the best part?',
    'steal my', 'i studied', 'i analyzed', 'so you don\'t have to',
    'this changes everything', 'we are so back', 'we\'re so back',
    'this is huge', 'buckle up', 'thread 🧵', 'a thread:', 'mega thread'
  ];

  const wordCount = (t) => (t.trim().match(/\S+/g) || []).length;
  const count = (t, re) => (t.match(re) || []).length;
  const anyOf = (t, list) => list.filter((p) => t.includes(p)).length;

  const RULES = [
    {
      id: 'leaked-assistant',
      label: 'Leaked assistant text',
      weight: 90,
      test: (t) =>
        count(t, rx('\\b(as an ai (language )?model|i\'m sorry,? but i (can\'t|cannot)|i cannot fulfill|as a large language model|here is (the|a) (rewritten|revised) (post|tweet)|certainly! here)'))
    },
    {
      id: 'prompt-residue',
      label: 'Prompt residue',
      weight: 85,
      test: (t) =>
        count(t, rx('\\b(sure[,!] here\'s|\\[insert [a-z ]+\\]|as requested,|tone: |word count:|hashtags: )'))
    },
    {
      id: 'emoji-bullets',
      label: 'Emoji bullet deck',
      weight: 30,
      // Lines that start with a decorative emoji — the LinkedIn-ification tell.
      test: (t) => {
        const lines = t.split('\n').filter((l) => l.trim());
        const hits = lines.filter((l) =>
          /^\s*(?:[✅✔️🚀💡🔥📌🎯⚡️🧠📈💰👇🔑⭐️✨🙌💬🛠️📊🤝🎁]|[-–•*]\s*[\p{Extended_Pictographic}])/u.test(l)
        ).length;
        return hits >= 3 ? hits : 0;
      }
    },
    {
      id: 'antithesis',
      label: '"Not X — it\'s Y" cadence',
      weight: 22,
      test: (t) =>
        count(t, rx('(it\'s|this|that)\\s+(is\\s+)?not\\s+(just\\s+)?[^.!?\\n]{2,40}[—.,-]\\s*(it\'s|it is|this is|that\'s)\\s')) +
        count(t, rx('\\bnot\\s+because[^.!?\\n]{2,40},?\\s*but\\s+because\\b'))
    },
    {
      id: 'em-dash',
      label: 'Em-dash habit',
      weight: 12,
      test: (t) => {
        const n = count(t, /—/g);
        return n >= 2 ? n - 1 : 0;
      }
    },
    {
      id: 'rule-of-three',
      label: 'Rule-of-three triads',
      weight: 14,
      test: (t) =>
        count(t, rx('\\b\\w+,\\s+\\w+,\\s+and\\s+\\w+\\b')) >= 2
          ? count(t, rx('\\b\\w+,\\s+\\w+,\\s+and\\s+\\w+\\b'))
          : 0
    },
    {
      id: 'lexicon',
      label: 'LLM vocabulary',
      weight: 13,
      test: (t) => anyOf(t, LEXICON)
    },
    {
      id: 'engagement-bait',
      label: 'Engagement bait',
      weight: 18,
      test: (t) => anyOf(t, BAIT)
    },
    {
      id: 'listicle',
      label: 'Numbered listicle thread',
      weight: 16,
      test: (t) => {
        const numbered = count(t, /^\s*(\d{1,2})[.)]\s+\S/gm);
        const slashed = count(t, /^\s*\d{1,2}\/(\d{1,2})?\s*$/gm);
        return numbered >= 4 || slashed >= 1 ? Math.max(numbered, slashed * 3) : 0;
      }
    },
    {
      id: 'colon-headline',
      label: 'Headline: subtitle structure',
      weight: 10,
      test: (t) => count(t, /^[A-Z][^:\n]{3,40}:\s+\S/gm) >= 2 ? count(t, /^[A-Z][^:\n]{3,40}:\s+\S/gm) : 0
    },
    {
      id: 'arrows',
      label: 'Arrow/bullet glyph spam',
      weight: 10,
      test: (t) => {
        const n = count(t, /[→↳➜►▪️▶️]/g);
        return n >= 3 ? n : 0;
      }
    },
    {
      id: 'hashtag-spam',
      label: 'Hashtag spam',
      weight: 12,
      test: (t) => {
        const n = count(t, /#\w+/g);
        return n >= 5 ? n : 0;
      }
    },
    {
      id: 'staccato',
      label: 'One-line-paragraph cadence',
      weight: 14,
      test: (t) => {
        const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 5) return 0;
        const short = lines.filter((l) => wordCount(l) > 0 && wordCount(l) <= 6).length;
        return short / lines.length >= 0.6 ? short : 0;
      }
    },
    {
      id: 'generic-praise',
      label: 'Generic bot reply',
      weight: 35,
      test: (t) => {
        if (wordCount(t) > 45) return 0;
        return count(t, rx('\\b(great point|well said|couldn\'t agree more|this really resonates|thanks for sharing|absolutely[.!]|spot on[.!]|insightful (post|thread)|love this take|100% agree)\\b'));
      }
    },
    {
      id: 'invisible-chars',
      label: 'Invisible/pasted characters',
      weight: 25,
      test: (t) => count(t, /[​-‍⁠﻿ ]/g)
    },
    {
      id: 'ai-disclosure',
      label: 'Self-declared AI account',
      weight: 40,
      test: (t, ctx) =>
        ctx && ctx.handle && /(^|_)(gpt|ai|bot)(_|\d|$)/i.test(ctx.handle) ? 1 : 0
    }
  ];

  /**
   * @param {string} text  tweet body
   * @param {{handle?: string}} ctx
   * @returns {{score:number, reasons:{id:string,label:string,hits:number,points:number}[]}}
   */
  function score(text, ctx) {
    const raw = text || '';
    const lower = raw.toLowerCase();
    const reasons = [];
    let total = 0;

    for (const rule of RULES) {
      // Lexicon-style rules match on lowercase; regex rules carry their own /i.
      const hits = rule.test(rule.id === 'lexicon' || rule.id === 'engagement-bait' ? lower : raw, ctx) || 0;
      if (!hits) continue;
      // Diminishing returns: a second hit is worth half, a third a third, ...
      let points = 0;
      for (let i = 0; i < Math.min(hits, 4); i++) points += rule.weight / (i + 1);
      points = Math.round(points);
      total += points;
      reasons.push({ id: rule.id, label: rule.label, hits, points });
    }

    // Very short posts don't carry enough signal to judge on style alone.
    if (wordCount(raw) < 12) {
      const strong = reasons.some((r) => ['leaked-assistant', 'prompt-residue', 'generic-praise'].includes(r.id));
      if (!strong) total = Math.round(total * 0.4);
    }

    reasons.sort((a, b) => b.points - a.points);
    return { score: Math.min(100, total), reasons };
  }

  self.SlopDetector = { score, RULES };
})();

'use strict';

// Plain-Node test harness for src/detector.js — no framework, no npm install.
//
// detector.js is a browser IIFE that does `self.SlopDetector = {...}`.
// We shim `self` onto globalThis before requiring it.

const path = require('path');
const assert = require('assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'src', 'detector.js'));
const { score } = globalThis.SlopDetector;

const HIGHLIGHT_THRESHOLD = 40;
const ACTION_THRESHOLD = 65;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLOP = [
  {
    label: 'emoji-bullet listicle',
    text:
      '✅ Wake up at 5am\n' +
      '🚀 Ship one feature\n' +
      '💡 Read for 20 minutes\n' +
      '🔥 No phone before noon\n' +
      '📈 Review your goals\n' +
      'Do this for 30 days and thank me later.'
  },
  {
    label: 'not-just-X-it\'s-Y hustle post',
    text:
      "It's not just a morning routine — it's a complete identity shift.\n" +
      "This isn't just discipline, it's freedom.\n" +
      "It's not just about waking up early — it's about owning your day.\n" +
      'Consistency, patience, and reps — that is the whole game.'
  },
  {
    label: 'leaked "as an AI language model"',
    text:
      "As an AI language model, I don't have personal opinions, but here is a summary of the article you asked about: the market moved sideways this week amid mixed earnings."
  },
  {
    label: 'leaked refusal boilerplate',
    text:
      "I'm sorry, but I cannot fulfill this request as it goes against my guidelines. I can however help you rewrite the tweet in a more neutral tone if that would be useful."
  },
  {
    label: 'generic bot reply',
    text: "Great point! Thanks for sharing this. Couldn't agree more, insightful thread."
  },
  {
    label: 'engagement bait thread opener',
    text:
      'Bookmark this 🧵\n' +
      '1/9\n' +
      "Most people don't know this, but here's the thing: you're leaving money on the table.\n" +
      "Here's the kicker — nobody talks about this.\n" +
      'Steal my exact framework below.\n' +
      "Save this for later. You're welcome."
  },
  {
    label: 'LLM vocabulary cluster',
    text:
      "In today's fast-paced world, we need to delve into the ever-evolving, ever-changing tapestry of modern work. " +
      "This is not just a buzzword — it's a mindset shift, and it's not just about output — it's about impact. " +
      'This is a real game-changer, and it underscores a pivotal, meticulous shift in how a myriad of teams operate, ' +
      'embracing agility, resilience, and innovation, while chasing growth, scale, and impact. ' +
      "It's worth noting that at its core, this is a testament to what's possible when you unlock the potential of a " +
      'truly robust solution — a genuine game changer for the ever-evolving realm of remote work.'
  },
  {
    label: 'numbered listicle staccato thread',
    text:
      '1. Wake up early\n' +
      '2. Skip the phone\n' +
      '3. Drink water first\n' +
      '4. Move your body\n' +
      '5. Write three lines\n' +
      '6. Read for ten minutes\n' +
      '7. Plan your top task\n' +
      '8. Protect your morning\n' +
      'Save this for later.\n' +
      'Simple. Repeatable. Life-changing.'
  },
  {
    label: 'arrow/bullet glyph spam',
    text:
      'Growth mindset →\n' +
      '↳ Discipline beats motivation\n' +
      '↳ Systems beat goals\n' +
      '↳ Consistency beats intensity\n' +
      'Bookmark this before it disappears.'
  },
  {
    label: 'hashtag spam promo post',
    text:
      'This changes everything. New drop is live and honestly this is huge — link in bio for the full collection, ' +
      "don't sleep on it. #ai #startup #hustle #grind #entrepreneur #mindset #growth"
  },
  {
    label: 'colon headline listicle',
    text:
      'Discipline: the foundation of everything\n' +
      'Consistency: how habits compound\n' +
      'Focus: your most underrated skill\n' +
      "Bookmark this — save this for later, you're welcome."
  },
  {
    label: 'prompt residue leak',
    text:
      "Sure, here's a punchy version for you:\n" +
      'Tone: motivational\n' +
      'Word count: 40\n' +
      'Hashtags: #mindset #grind'
  },
  {
    label: 'em-dash heavy hustle rant',
    text:
      'This is not about luck — it is about reps — and reps are not glamorous — they are just repetitive — ' +
      'so stop waiting for motivation and start building the system that carries you when motivation is gone. ' +
      'It comes down to grit, reps, and consistency, practiced morning, noon, and night.'
  },
  {
    label: 'invisible-character padded copy-paste',
    text:
      'This is the​ secret​ most​ people​ never​ tell​ you​ about​ growing​ an​ audience​ fast.'
  },
  {
    label: 'AI handle corroborated by bait text',
    text: 'Just dropped a new post about productivity 🚀 Bookmark this, you\'re welcome. Follow for more.',
    ctx: { handle: 'growth_gpt_23' }
  }
];

const HUMAN = [
  {
    // Regression: real account @ai_for_success (human AI-news poster) was
    // flagged at exactly 40 by the handle rule alone.
    label: 'human with ai in handle, normal text',
    text: 'Google just shipped a new Gemini update, thread with my testing notes coming later today',
    ctx: { handle: 'ai_for_success' }
  },
  {
    label: 'casual shitpost',
    text: 'why is my cat sitting in the sink again. she does this every single day and I cannot stop her'
  },
  {
    label: 'typo-laden opinion',
    text: 'ngl the new update kinda sucks, teh sidebar keeps collapsing on me for no reason lol'
  },
  {
    label: 'one-off hot take',
    text: 'unpopular opinion but pineapple on pizza is actually fine, yall are just dramatic'
  },
  {
    label: 'technical observation',
    text:
      'Spent the afternoon chasing a race condition in our websocket reconnect logic. Turned out the retry timer ' +
      "wasn't being cleared on unmount so we had two timers stacking. Classic."
  },
  {
    label: 'link with brief comment',
    text: 'this writeup on postgres index bloat is really good, saved me a headache last week: pg-indexes.example.com/bloat'
  },
  {
    label: 'short joke',
    text: 'my code compiled on the first try today so obviously something is very wrong'
  },
  {
    label: 'longer genuine thought',
    text:
      "Been thinking about how much of my job is just naming things well. Half the bugs I've fixed this year weren't " +
      'logic errors, they were a variable named wrong six months ago that made everyone downstream assume the wrong thing. ' +
      "Naming is basically documentation you can't skip reading."
  },
  {
    label: 'weekend plans tweet',
    text: 'taking the dog to the lake this weekend if the weather holds up, been way too long since we did that'
  },
  {
    label: 'reply agreeing briefly but specifically',
    text: 'yeah the third example in your post is the one that actually clicked for me, the first two felt kind of abstract'
  },
  {
    label: 'complaint about traffic',
    text: 'stuck on the 405 for 40 minutes for a 10 minute drive. los angeles traffic is not real it cannot hurt you'
  },
  {
    label: 'single legitimate em-dash',
    text: "I almost skipped the talk — glad I didn't, the Q&A alone was worth showing up for."
  },
  {
    label: 'single natural use of "delve"',
    text: "Might delve into the tax code this weekend since I finally have time, not looking forward to it though."
  },
  {
    label: 'genuine three-item list',
    text: "Packed sunscreen, water, and a paperback for the trip. Forgot the charger though, of course."
  },
  {
    label: 'empty string',
    text: ''
  },
  {
    label: 'very short human reply',
    text: 'lol same'
  }
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let failures = 0;
let total = 0;
const rows = [];

function checkScoreShape(label, result) {
  assert.ok(
    typeof result.score === 'number' && result.score >= 0 && result.score <= 100,
    `${label}: score out of [0,100] range (${result.score})`
  );
  assert.ok(Array.isArray(result.reasons), `${label}: reasons is not an array`);
  const summed = result.reasons.reduce((a, r) => a + r.points, 0);
  assert.ok(
    summed >= result.score - 1 || result.score === 100,
    `${label}: reasons points (${summed}) look inconsistent with score (${result.score})`
  );
}

function run(label, fn) {
  total++;
  try {
    fn();
  } catch (err) {
    failures++;
    console.log(`FAIL  ${label}: ${err.message}`);
  }
}

// --- Robustness / shape checks -------------------------------------------

run('score(empty string) does not throw', () => {
  const r = score('');
  checkScoreShape('empty string', r);
});

run('score(undefined) does not throw', () => {
  const r = score(undefined);
  checkScoreShape('undefined', r);
});

run('score(short random string) does not throw', () => {
  const r = score('ok');
  checkScoreShape('short string', r);
});

run('score(whitespace only) does not throw', () => {
  const r = score('   \n\n   ');
  checkScoreShape('whitespace only', r);
});

run('score with no ctx does not throw', () => {
  const r = score('just a normal sentence with no special structure at all here');
  checkScoreShape('no ctx', r);
});

// --- SLOP fixtures ----------------------------------------------------------

let slopAtLeast65 = 0;
const slopScores = [];

for (const fixture of SLOP) {
  const result = score(fixture.text, fixture.ctx);
  slopScores.push(result.score);
  const topReason = result.reasons[0] ? result.reasons[0].label : '(none)';
  rows.push({ set: 'SLOP', label: fixture.label, score: result.score, topReason });

  run(`SLOP "${fixture.label}" scores >= ${HIGHLIGHT_THRESHOLD}`, () => {
    checkScoreShape(fixture.label, result);
    assert.ok(
      result.score >= HIGHLIGHT_THRESHOLD,
      `expected score >= ${HIGHLIGHT_THRESHOLD}, got ${result.score}`
    );
  });

  if (result.score >= ACTION_THRESHOLD) slopAtLeast65++;
}

run(`at least 8 SLOP fixtures score >= ${ACTION_THRESHOLD}`, () => {
  assert.ok(
    slopAtLeast65 >= 8,
    `only ${slopAtLeast65}/${SLOP.length} SLOP fixtures scored >= ${ACTION_THRESHOLD}`
  );
});

// --- HUMAN fixtures ----------------------------------------------------------

const humanScores = [];

for (const fixture of HUMAN) {
  const result = score(fixture.text, fixture.ctx);
  humanScores.push(result.score);
  const topReason = result.reasons[0] ? result.reasons[0].label : '(none)';
  rows.push({ set: 'HUMAN', label: fixture.label, score: result.score, topReason });

  run(`HUMAN "${fixture.label}" scores < ${HIGHLIGHT_THRESHOLD}`, () => {
    checkScoreShape(fixture.label, result);
    assert.ok(
      result.score < HIGHLIGHT_THRESHOLD,
      `expected score < ${HIGHLIGHT_THRESHOLD}, got ${result.score}`
    );
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('');
console.log('SET     SCORE  LABEL / TOP REASON');
console.log('-----   -----  ' + '-'.repeat(60));
for (const row of rows) {
  const scoreStr = String(row.score).padStart(3, ' ');
  console.log(`${row.set.padEnd(6)}  ${scoreStr}    ${row.label}  ->  ${row.topReason}`);
}

const slopMin = Math.min(...slopScores);
const slopMax = Math.max(...slopScores);
const humanMin = Math.min(...humanScores);
const humanMax = Math.max(...humanScores);

console.log('');
console.log(`SLOP  scores: min=${slopMin} max=${slopMax} (n=${SLOP.length}, >=65: ${slopAtLeast65})`);
console.log(`HUMAN scores: min=${humanMin} max=${humanMax} (n=${HUMAN.length})`);
console.log('');

const passed = total - failures;
console.log(failures === 0 ? `PASS ${passed}/${total}` : `FAIL ${passed}/${total}`);

process.exit(failures === 0 ? 0 : 1);

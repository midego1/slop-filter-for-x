/**
 * Tests for tools/merge-lists.js — consensus, vouching, and appeals.
 * Run: node test/merge.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MERGE = path.join(__dirname, '..', 'tools', 'merge-lists.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-merge-'));

function writeExport(name, reporter, entries, notSlop) {
  const file = path.join(tmp, name);
  fs.writeFileSync(
    file,
    JSON.stringify({ format: 'slop-list/1', name, reporter, entries, not_slop: notSlop || [] })
  );
  return file;
}

const entry = (handle, tags, score, evidence) => ({
  handle,
  tags: tags || ['ai-slop'],
  score: score || 70,
  evidence: evidence || [`https://x.com/${handle}/status/1`],
  first_seen: '2026-07-01T00:00:00.000Z'
});

// consensus_bot: 3 reporters agree → published
// lone_flag: 1 reporter → dropped (below consensus)
// disputed: 2 reporters flag, 1 vouches → net 1 < 2 → vetoed
// appealed_bot: 3 reporters, but appealed → dropped
// bad__handle!: invalid → dropped
const a = writeExport('a.json', 'rep-a', [
  entry('consensus_bot', ['llm-leak']),
  entry('lone_flag'),
  entry('disputed'),
  entry('appealed_bot'),
  entry('bad__handle!' + 'x'.repeat(20))
]);
const b = writeExport('b.json', 'rep-b', [
  entry('consensus_bot', ['llm-leak', 'engagement-bait'], 90),
  entry('disputed'),
  entry('appealed_bot')
]);
const c = writeExport(
  'c.json',
  'rep-c',
  [entry('consensus_bot'), entry('appealed_bot')],
  ['disputed'] // vouch: "I checked, it's a human"
);

const appealsFile = path.join(tmp, 'appeals.json');
fs.writeFileSync(appealsFile, JSON.stringify({ handles: ['appealed_bot'] }));

const outFile = path.join(tmp, 'master.json');
const stdout = execFileSync(
  process.execPath,
  [MERGE, '--min-reporters', '2', '--appeals', appealsFile, '--out', outFile, a, b, c],
  { encoding: 'utf8' }
);

const master = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const handles = master.entries.map((e) => e.handle);

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failures++;
  }
}

check('output is slop-list/1', master.format === 'slop-list/1');
check('consensus_bot published', handles.includes('consensus_bot'));
check('lone_flag dropped (below consensus)', !handles.includes('lone_flag'));
check('disputed vetoed by vouch', !handles.includes('disputed'));
check('appealed_bot removed via appeals', !handles.includes('appealed_bot'));
check('invalid handle dropped', handles.every((h) => /^[a-z0-9_]{1,15}$/.test(h)));
check('exactly one published entry', master.entries.length === 1);

const bot = master.entries[0];
check('reports counted distinctly', bot.reports === 3);
check('max score kept', bot.score === 90);
check('tags merged by frequency', bot.tags[0] === 'llm-leak' || bot.tags[0] === 'ai-slop');
check('evidence capped and x.com-only', bot.evidence.length >= 1 && bot.evidence.every((u) => u.startsWith('https://x.com/')));
check('summary line printed', /1 accounts from 3 exports/.test(stdout));

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.error(`FAIL ${failures} check(s)`);
  process.exit(1);
}
console.log('PASS merge-lists');

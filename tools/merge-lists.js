#!/usr/bin/env node
/**
 * Merge personal slop-list exports into one master community list.
 *
 * An account only makes the master list when enough *distinct* reporters
 * flagged it, minus anyone who explicitly vouched for it ("not_slop" in their
 * export). Appealed handles are excluded outright. This is the whole
 * governance model: consensus in, appeal out.
 *
 * Usage:
 *   node tools/merge-lists.js [--min-reporters 2] [--appeals appeals.json]
 *                             [--name "My community list"] [--out master-list.json]
 *                             export1.json export2.json ...
 */
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const opts = { minReporters: 2, out: 'master-list.json', appeals: null, name: 'community slop list', files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-reporters') opts.minReporters = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--appeals') opts.appeals = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else opts.files.push(a);
  }
  if (!opts.files.length) {
    console.error('usage: node tools/merge-lists.js [options] export1.json export2.json ...');
    process.exit(2);
  }
  return opts;
}

function normHandle(h) {
  const n = String(h || '').replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(n) ? n : null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const appeals = new Set();
  if (opts.appeals) {
    const doc = JSON.parse(fs.readFileSync(opts.appeals, 'utf8'));
    (doc.handles || []).forEach((h) => {
      const n = normHandle(h);
      if (n) appeals.add(n);
    });
  }

  // handle -> { reporters:Set, vouchers:Set, tags:Map(tag->count), evidence:Set, maxScore, firstSeen }
  const accounts = new Map();
  let filesRead = 0;
  let skipped = 0;

  for (const file of opts.files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`skip ${file}: ${err.message}`);
      skipped++;
      continue;
    }
    if (!doc || doc.format !== 'slop-list/1' || !Array.isArray(doc.entries)) {
      console.error(`skip ${file}: not a slop-list/1 export`);
      skipped++;
      continue;
    }
    // Fall back to the filename so old exports without a reporter id still
    // count as one distinct voice each.
    const reporter = String(doc.reporter || path.basename(file));
    filesRead++;

    for (const e of doc.entries) {
      const h = normHandle(e && e.handle);
      if (!h) continue;
      const acc =
        accounts.get(h) || {
          handle: h,
          reporters: new Set(),
          vouchers: new Set(),
          tags: new Map(),
          evidence: new Set(),
          maxScore: 0,
          firstSeen: null
        };
      acc.reporters.add(reporter);
      (Array.isArray(e.tags) ? e.tags : []).forEach((t) => {
        if (typeof t === 'string') acc.tags.set(t, (acc.tags.get(t) || 0) + 1);
      });
      (Array.isArray(e.evidence) ? e.evidence : []).forEach((u) => {
        if (typeof u === 'string' && /^https:\/\/(x|twitter)\.com\//.test(u)) acc.evidence.add(u);
      });
      acc.maxScore = Math.max(acc.maxScore, Number(e.score) || 0);
      const ts = e.first_seen ? Date.parse(e.first_seen) : NaN;
      if (!Number.isNaN(ts)) acc.firstSeen = acc.firstSeen === null ? ts : Math.min(acc.firstSeen, ts);
      accounts.set(h, acc);
    }

    for (const v of Array.isArray(doc.not_slop) ? doc.not_slop : []) {
      const h = normHandle(v);
      if (!h) continue;
      const acc = accounts.get(h);
      if (acc) acc.vouchers.add(reporter);
      else accounts.set(h, { handle: h, reporters: new Set(), vouchers: new Set([reporter]), tags: new Map(), evidence: new Set(), maxScore: 0, firstSeen: null });
    }
  }

  const entries = [];
  let appealed = 0;
  let belowConsensus = 0;
  let vetoed = 0;

  for (const acc of accounts.values()) {
    if (appeals.has(acc.handle)) {
      appealed++;
      continue;
    }
    const net = acc.reporters.size - acc.vouchers.size;
    if (acc.reporters.size < opts.minReporters) {
      belowConsensus++;
      continue;
    }
    if (net < opts.minReporters) {
      vetoed++;
      continue;
    }
    entries.push({
      handle: acc.handle,
      tags: [...acc.tags.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 6),
      score: acc.maxScore,
      reports: acc.reporters.size,
      vouches: acc.vouchers.size,
      evidence: [...acc.evidence].slice(0, 5),
      first_reported: acc.firstSeen ? new Date(acc.firstSeen).toISOString() : null
    });
  }

  entries.sort((a, b) => b.reports - a.reports || a.handle.localeCompare(b.handle));

  const out = {
    format: 'slop-list/1',
    name: opts.name,
    generated: new Date().toISOString(),
    min_reporters: opts.minReporters,
    sources: filesRead,
    entries
  };

  fs.writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n');
  console.log(
    `${opts.out}: ${entries.length} accounts from ${filesRead} exports ` +
      `(${belowConsensus} below consensus, ${vetoed} vetoed by vouches, ${appealed} appealed, ${skipped} files skipped)`
  );
}

main();

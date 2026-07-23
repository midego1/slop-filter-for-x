#!/usr/bin/env node
/**
 * CI gate for exports/: every *.json must be a well-formed slop-list/1
 * export whose entries carry evidence. Exits 1 with per-file errors on any
 * violation; passes silently when exports/ is empty.
 *
 * Usage: node tools/validate-exports.js [dir]   (default: exports/)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'exports');
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const EVIDENCE_RE = /^https:\/\/(x|twitter)\.com\//;

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  : [];

let failures = 0;

for (const file of files) {
  const errors = [];
  const full = path.join(dir, file);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${file}: invalid JSON (${err.message})`);
    failures++;
    continue;
  }

  if (!doc || doc.format !== 'slop-list/1') errors.push('format must be "slop-list/1"');
  if (!doc.reporter || typeof doc.reporter !== 'string') errors.push('missing reporter id');
  if (!Array.isArray(doc.entries)) errors.push('entries must be an array');

  (Array.isArray(doc.entries) ? doc.entries : []).forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!e || typeof e.handle !== 'string' || !HANDLE_RE.test(e.handle.replace(/^@/, ''))) {
      errors.push(`${at}: invalid handle`);
      return;
    }
    const evidence = Array.isArray(e.evidence) ? e.evidence.filter((u) => EVIDENCE_RE.test(u)) : [];
    if (!evidence.length) errors.push(`${at} (@${e.handle}): no x.com evidence links`);
    if (e.tags && (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== 'string'))) {
      errors.push(`${at}: tags must be strings`);
    }
    if (e.score != null && (typeof e.score !== 'number' || e.score < 0 || e.score > 100)) {
      errors.push(`${at}: score must be 0-100`);
    }
  });

  if (Array.isArray(doc.not_slop) && doc.not_slop.some((h) => typeof h !== 'string')) {
    errors.push('not_slop must be an array of handles');
  }

  if (errors.length) {
    console.error(`FAIL ${file}:`);
    errors.slice(0, 20).forEach((e) => console.error(`  - ${e}`));
    failures++;
  } else {
    console.log(`ok   ${file} (${doc.entries.length} entries)`);
  }
}

console.log(`${files.length} export file(s) checked, ${failures} failed`);
process.exit(failures ? 1 : 0);

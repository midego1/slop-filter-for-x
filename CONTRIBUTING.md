# Contributing

## Code

PRs welcome. `node test/detector.test.js && node test/merge.test.js` must
pass; CI also syntax-checks every source file. Detector tuning PRs should
include fixtures demonstrating the change.

Any PR that touches extension runtime files (`manifest.json`, `src/`,
`popup/`, `icons/`) must bump `"version"` in `manifest.json` — CI enforces
this. List-only PRs (`exports/`, `appeals.json`) don't need a bump.

## List entries

Read [docs/LIST_FORMAT.md](docs/LIST_FORMAT.md) first — it defines the
format and the governance rules. In short:

- **Add accounts:** PR your export into [exports/](exports/) (one file per
  reporter, keep the same filename as your list grows). Every entry needs
  evidence links; CI rejects exports without them. Accounts only reach
  `master-list.json` when at least 2 distinct reporters agree.
- **Appeal:** open an issue titled `appeal: @handle` with a link to the
  account. A maintainer adds cleared handles to [appeals.json](appeals.json);
  the next CI run removes them from the master list, and subscribers pick it
  up within ~6 hours.
- **Vouch:** if an account on the list is human, add it to your extension
  allowlist and re-export — your `not_slop` entry counts against its
  consensus.

Never hand-edit `master-list.json`; CI regenerates it.

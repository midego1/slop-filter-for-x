# slop-list/1 format

A slop list is a single JSON file. The same format is used for personal
exports (one reporter) and merged master lists (many reporters).

```json
{
  "format": "slop-list/1",
  "name": "community slop list",
  "generated": "2026-07-23T12:00:00.000Z",
  "reporter": "9f6c1c1e-…",
  "entries": [
    {
      "handle": "example_handle",
      "tags": ["ai-slop", "engagement-bait"],
      "score": 85,
      "reports": 4,
      "vouches": 0,
      "evidence": ["https://x.com/example_handle/status/123"],
      "first_reported": "2026-07-01T09:30:00.000Z"
    }
  ],
  "not_slop": ["some_human_handle"]
}
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `"slop-list/1"`. Consumers must reject anything else. |
| `name` | no | Display name, shown in the extension badge (`On list: <name>`). |
| `reporter` | exports | Random UUID identifying one contributor. Not linked to any account — it exists only so the merge tool can count *distinct* reporters. |
| `entries[].handle` | yes | X handle without `@`. Must match `[A-Za-z0-9_]{1,15}` or it is dropped. |
| `entries[].tags` | no | From the shared taxonomy below. Max 6. |
| `entries[].score` | no | Highest detector score seen (0–100). |
| `entries[].evidence` | no | Links to the actual posts that triggered the flag. Only `https://x.com/…` / `https://twitter.com/…` URLs survive merging. |
| `entries[].reports` / `vouches` | master lists | Distinct reporters for / against, filled in by the merge tool. |
| `not_slop` | exports | Handles the reporter explicitly cleared (their local allowlist). Counts as a counter-vote in merges. |

## Tag taxonomy

| Tag | Meaning |
|---|---|
| `ai-slop` | Stylistic LLM tells (emoji decks, "not X — it's Y", vocabulary clusters, staccato cadence) |
| `llm-leak` | Leaked assistant text or prompt residue ("As an AI language model…") |
| `bot-reply` | Generic automated replies ("Great point! Thanks for sharing") |
| `engagement-bait` | Bait phrasing, listicle threads ("Bookmark this 🧵") |
| `spam` | Hashtag spam, invisible characters |
| `self-declared-ai` | Handle or bio declares the account automated |

## Governance model (for a shared repo)

The "database" is a git repo — no server to run, full audit history for free:

```
your-slop-list-repo/
├── exports/            # one file per contributor, submitted by PR
├── appeals.json        # {"handles": ["cleared_handle", …]}, changed by PR
├── master-list.json    # generated — never hand-edited
└── .github/workflows/  # CI runs the merge on every merge to main
```

1. **Contribute:** run your extension, review your queue (queue mode — so a
   human confirmed every entry), export from the History tab, PR the file
   into `exports/`.
2. **Merge:** CI runs
   `node tools/merge-lists.js --min-reporters 2 --appeals appeals.json exports/*.json`.
   An account is published only when at least 2 distinct reporters flagged it
   and net reports (reports − vouches) stay ≥ 2.
3. **Appeal:** anyone can open an issue with the handle; a maintainer adds it
   to `appeals.json`, and the next CI run removes it everywhere. Subscribers
   pick the removal up on their next 6-hour refresh.
4. **Subscribe:** paste the raw URL of `master-list.json` into the extension's
   "Community lists" box.

### Why the friction is the point

A merged list is a public file of accusations against real accounts. The
rules above are load-bearing, not ceremony:

- **Evidence required.** Entries carry links to the actual posts. A PR adding
  an export with no evidence is reviewable by nobody — reject it.
- **Consensus required.** One person's heuristic false positive should never
  publish anyone. Raise `--min-reporters` as the contributor pool grows.
- **Appeals are cheap and final.** Getting off the list must be easier than
  getting on it.
- **Tags are opinions.** "Flagged as ai-slop by N reporters" is a defensible
  statement; "verified bot" is not. Keep the framing honest.

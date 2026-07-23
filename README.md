# Slop Filter for X

A Chrome extension (Manifest V3) that scores posts in your X (Twitter) timeline
for AI-slop tells — leaked assistant boilerplate, emoji bullet decks, LLM
vocabulary clusters, engagement bait, and similar patterns — and flags,
queues, or blocks/mutes the accounts posting it. Everything runs in a content
script on `x.com` / `twitter.com`; there is no backend. Flagged accounts are
tagged by *why* they were flagged, and your reviewed list can be exported,
merged with other people's exports, and shared as a community blocklist —
see [Community lists](#community-lists).

This is a personal heuristic filter, not a moderation product. It will
misfire on real people who happen to write in a similar cadence.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder (the one
   containing `manifest.json`).
5. Visit `x.com` or `twitter.com` and browse normally.

## Usage

Click the extension icon to open the popup, which has three tabs: Settings,
Queue, and History.

**Modes** (Settings → "What to do above the action threshold"):

- **Highlight only** — flagged posts get a badge showing the score and the
  triggered rules. Nothing else happens.
- **Queue for my review** (default) — posts scoring above the action
  threshold have their author added to the Queue tab instead of being acted
  on immediately. You review the queue and act manually (or "Act on all").
- **Act automatically** — the configured action (block or mute) fires
  immediately once a post crosses the action threshold, subject to the rate
  limit below. The popup shows a warning that this mode blocks accounts
  without asking, and recommends running in queue mode first to check for
  false positives.

**Thresholds:** two sliders control behavior — highlight threshold (default
**40**) decides when a post gets a badge at all; action threshold (default
**65**) decides when it's eligible for queueing/blocking. Both are adjustable
from 10–100 (highlight) and 20–100 (action) in the popup.

**Action:** Block or Mute. Mute is described in the UI as "reversible,
quieter" — it doesn't notify the account and is easy to undo.

**Rate limit:** "Max actions per hour" (default **15**, range 1–60) caps how
many blocks/mutes the extension will perform in auto mode in a rolling
60-minute window, via a simple token-bucket check before each action.

**Per-post "Not slop" button:** every flagged post gets a badge with the
configured action button and a "Not slop" button. Clicking "Not slop" adds
the author's handle to the allowlist and un-flags the post immediately.

**Allowlist:** a textarea in Settings ("Never flag these handles") lists
handles that are never scored or flagged. Your own account is always
excluded automatically.

## How detection works

`src/detector.js` runs a set of weighted regex/heuristic rules against each
post's text (and, for one rule, the author's handle). Each rule contributes
points on a hit; a second hit from the same rule is worth half, a third a
third, and so on (diminishing returns), and the total is clamped to 100.
Posts under 12 words have their score dampened by 60% unless a strong tell
(leaked assistant text, prompt residue, or a generic bot reply) fired, since
short posts don't carry enough stylistic signal on their own.

Strongest signals, roughly by weight:

| Rule | Weight | What it catches |
|---|---|---|
| Leaked assistant text | 90 | "as an AI language model", "I cannot fulfill...", etc. |
| Prompt residue | 85 | "sure, here's...", `[insert ...]`, "tone:", "word count:" |
| Self-declared AI account | 40 | handle matching `gpt`/`ai`/`bot` as a distinct segment |
| Generic bot reply | 35 | short replies like "great point", "spot on!", "100% agree" |
| Emoji bullet deck | 30 | ≥3 lines starting with a decorative emoji or emoji bullet |
| Invisible/pasted characters | 25 | zero-width spaces and similar pasted-from-somewhere chars |
| "Not X — it's Y" cadence | 22 | the antithesis rhetorical pattern LLMs overuse |
| Engagement bait | 18 | "let that sink in", "save this for later", "thread 🧵", etc. |
| Numbered listicle thread | 16 | ≥4 numbered lines, or `n/` thread markers |
| LLM vocabulary | 13 | "delve", "tapestry", "leverage the power", "unlock the", etc. |
| Staccato cadence | 14 | ≥5 lines, ≥60% of them 6 words or fewer |
| Rule-of-three triads | 14 | "X, Y, and Z" patterns repeated |
| Em-dash habit | 12 | 2+ em-dashes in one post |
| Hashtag spam | 12 | 5+ hashtags |
| Headline: subtitle structure | 10 | repeated "Title: detail" lines |
| Arrow/bullet glyph spam | 10 | 3+ of `→ ↳ ➜ ► ▪️ ▶️` |

This is a heuristic scorer, not a model. It is English-biased (the lexicon
and cadence rules assume English prose) and it **will** false-positive —
some people genuinely write in short punchy lines, use em-dashes a lot, or
like the rule-of-three. That's the reason queue mode is the default and auto
mode is opt-in: you're expected to spot-check the queue before trusting the
extension to block on your behalf.

## Community lists

Every block/mute is logged locally with tags describing *why* (`ai-slop`,
`llm-leak`, `bot-reply`, `engagement-bait`, `spam`, `self-declared-ai` — see
[docs/LIST_FORMAT.md](docs/LIST_FORMAT.md)). That local database is the seed
for a shared, open-source blocklist:

1. **Export** — History tab → "Export my list (JSON)" downloads a
   `slop-list/1` file: your acted-on accounts with tags, max score, and
   evidence links, plus your allowlist as `not_slop` counter-votes. The file
   carries a random reporter UUID and nothing else about you.
2. **Merge** — `node tools/merge-lists.js --min-reporters 2 --appeals
   appeals.json exports/*.json` combines any number of exports into a master
   list. An account is only published when enough *distinct* reporters
   flagged it and net reports (reports − vouches) clear the threshold;
   appealed handles are removed outright.
3. **Subscribe** — paste the raw URL of any published `slop-list/1` file
   (GitHub raw / gist / pages only) into Settings → Community lists. Lists
   refresh every 6 hours. Accounts on a subscribed list get a purple badge,
   and the "When an account is on a subscribed list" setting decides whether
   they're just highlighted, queued for your review, or acted on
   automatically (through the same rate limiter).

The intended home for a shared list is a git repo — exports arrive by PR,
appeals by issue, CI regenerates `master-list.json` on merge. The repo *is*
the database: auditable history, no server, no accounts. The governance
rules (evidence required, consensus required, cheap appeals) are documented
in [docs/LIST_FORMAT.md](docs/LIST_FORMAT.md) — read them before publishing
a list; a public file naming real accounts is a list of accusations, and the
consensus/appeal mechanics are what keep it defensible.

## Caveats & risks

- **Undocumented API.** `src/api.js` calls X's internal web endpoints
  (`/i/api/1.1/blocks/create.json`, `mutes/users/create.json`, etc.) using
  the bearer token X's own web client ships, plus your session cookies and
  `ct0` CSRF token read from `document.cookie`. This is the same request
  your browser makes when you click Block in the UI, but it is not a public,
  stable API — X can change or break it at any time without notice, and
  using it this way likely falls outside X's Terms of Service.
- **Account risk.** Automated blocking/muting could, in theory, get flagged
  as bot-like behavior by X's own abuse systems. The per-hour action rate
  limit (default 15) exists specifically to keep automated activity from
  looking like a scripted attack — lower it if you're cautious.
- **Block vs. mute.** Blocking is reversible (via `unblock`, exposed in
  `SlopApi` but not currently wired into the UI) but is a visible, hostile
  action. Mute is silent to the other account and easier to walk back — pick
  it if you want a gentler default.
- **Local only.** There is no backend and no telemetry. The only network
  requests are the block/mute calls to X's own domain (your browser, your
  session) and — only if you subscribe to community lists — read-only
  fetches of those list files from GitHub raw/gist/pages. Nothing is ever
  uploaded anywhere; sharing your list is an explicit manual export.
  Settings, queue, log, stats, and list caches all live in
  `chrome.storage.local`.
- **Shared lists cut both ways.** Subscribing to someone's list means
  trusting their judgment; a bad list highlights (or, if you enable it,
  blocks) innocent accounts. Keep list mode on "Highlight only" or "Queue"
  unless you trust the list's governance, and remember every list hit can be
  cleared per-account with "Not slop".

## Tuning

All scoring lives in `src/detector.js`, in a single `RULES` array plus two
word lists:

- `LEXICON` — LLM-vocabulary words/phrases ("delve", "tapestry", "seamless",
  ...) scored by the `lexicon` rule.
- `BAIT` — engagement-bait phrases ("let that sink in", "follow for more",
  ...) scored by the `engagement-bait` rule.

To tune: edit a rule's `weight` to make it matter more or less, add/remove
entries from `LEXICON`/`BAIT`, or add a new rule object with an `id`,
`label`, `weight`, and a `test(text, ctx)` function returning a hit count (0
for no hit). No build step is required — reload the extension in
`chrome://extensions` after editing.

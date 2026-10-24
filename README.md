# AI Meeting Summary & Action Tracker

Turns a meeting transcript into reviewable, trackable work:

**Transcript → AI analysis → Human review → Approved tasks → Kanban tracking → Progress dashboard**

This is an upgrade of the original single-file Kanban board (`kanban_board.original.html`, kept as a backup). The Kanban
board is still fully usable when the AI service is unavailable.

Built for the Tech Yuva × GDG Gurugram Build-A-Thon 2026, problem statement **PS-02 – AI Meeting Summary and Action Tracker**
(transcript → summary, decisions, owners, deadlines; editable action list; status dashboard).

---

## Quick start (Demo mode — no API key needed)

Requirements: Python 3.10+ (Node.js 18+ only if you want to run the JS tests).

```bash
pip install -r requirements.txt
python run.py                    # → http://127.0.0.1:8000
```

Open http://127.0.0.1:8000. The header shows **“Demo mode (no AI key)”**. Click **Load Demo Meeting**, then **Analyze transcript**.
Demo mode uses a transparent, rule-based extractor (not AI) and is labelled that way everywhere in the UI and API.
Transcripts never leave your machine in demo mode.

> Open the app through the server (`python run.py`), not by double-clicking `index.html`: the browser needs the backend
> for analysis. The Kanban board and manual action items still work without it.

## Enabling live AI analysis

API keys live **only on the server**, in environment variables. They are never sent to the browser and never logged.

```bash
cp .env.example .env     # then edit .env — .env is git-ignored
```

Set **one** provider key (the provider is auto-detected, or set `AI_PROVIDER` explicitly):

| Provider | Variable | Default model (override with `AI_MODEL`) |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| OpenAI-compatible | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) | `gpt-4.1-mini` |

Restart `python run.py`. The header changes to **“Live AI · provider · model”**, and the privacy note on the meeting
page states that transcripts are sent to that provider. `FORCE_DEMO_MODE=1` forces demo mode even with a key set.
Other settings: `AI_TIMEOUT_SECONDS` (45), `AI_MAX_RETRIES` (1), `MAX_TRANSCRIPT_CHARS` (60000).

Adding another provider = one small class in `backend/providers/` (see `base.py`) + one line in the registry.

**Important:** the live-AI request/response handling is covered by tests that use mocked HTTP transports. It was **not**
exercised against the real provider APIs in this project's test runs (no keys were available). Try it once with your own
key before the demo, and keep Demo mode as the fallback.

### How AI output is made trustworthy
- The transcript is sent inside delimiters, and the system prompt tells the model to treat it as untrusted data.
- The server validates every response against a schema (`backend/validation.py`) and rejects malformed output with a clear, retryable error.
- Evidence excerpts are checked against the transcript. An unverifiable excerpt flags the item for review.
- A proposed owner who is not named anywhere in the transcript or participant list is cleared to **Unassigned**.
- A “confirmed” decision without verifiable evidence is downgraded to **needs clarification**. Hedged statements (“maybe we could…”) are never decisions.
- Missing deadlines stay empty. Vague ones (“next week”) are kept as text, not converted to a date.
- Confidence values are estimates and are displayed as such. Nothing becomes a task until a person approves it.

---

## The workflow

1. **Meetings → New meeting**: title, date/time, participants, project; paste or upload a `.txt` transcript.
2. **Analyze transcript**: summary, decisions (with evidence), action items (owner, deadline, priority, evidence, review flags), discussion notes, missing information.
3. **Review**: edit title/description/owner/due date/priority, mark reviewed, reject, delete duplicates, add items manually. Draft / approved / rejected items are visually distinct.
4. **Approve** selected or all remaining items → tasks appear in **Kanban → Open** with due date, assignee, priority, source meeting and evidence. Approval is idempotent (no duplicates on repeated clicks).
5. **Kanban**: drag-and-drop (or the ··· menu for keyboard users) across Open / In Progress / Hold / Completed. Cards show overdue / due today / due soon / unassigned / high-priority indicators and link back to the source meeting.
6. **Dashboard**: meeting and task metrics, status/priority/owner charts, overdue-by-owner, recent activity, and filters (meeting, project, owner, priority, status, due range).
7. **Traceability**: from a task (card or task dialog) open its meeting, jump to the exact action item, and highlight the evidence in the transcript. Re-analysing keeps earlier results under “Previous analyses”.

### Decisions worth knowing
- **Overdue** = due date is before today **and** status is not Completed. **Tasks On hold are included** (the deadline was still missed; cards say “· on hold”). **Due today is not overdue.** Completed tasks are never overdue.
- “Due soon” = within the next 3 days. “Unassigned” on the dashboard counts non-completed tasks only.
- Relative deadlines in demo mode (“by Friday”) are resolved from the **meeting date** and flagged for confirmation; “next Friday” and “next week” are treated as ambiguous and left without a date.
- A first-time visitor now sees an empty board with onboarding actions instead of the old sample cards.

## Data & storage

- Stored in the browser's `localStorage` under `meeting_tracker_v2` (schema version 2): tasks, meetings, analyses, activity log.
- **Existing Kanban data is preserved**: on first load the old `kanban_v3` array is migrated (all cards, columns, priorities and assignees kept; new fields added). The old key is never modified, and a copy is stored as `meeting_tracker_legacy_backup`.
- Malformed or partial stored data is sanitised on load; a corrupt v2 blob is kept under `meeting_tracker_v2_corrupt_backup`.
- **Data & backup** (header/footer): export everything as JSON, import with validation (a safety copy is saved first), or clear all data.
- **localStorage is per browser and per device. It is not shared team storage, does not sync, and is lost if browser data is cleared.** There is no multi-user or real-time collaboration in this version.
- No database is needed in this architecture (the backend is stateless), so there is no SQLite or server-side migration code. The schema migration lives in `static/core.js` (`migrate`).

## Project layout

```
run.py                     launcher (python run.py)
backend/
  main.py                  FastAPI: /api/health, /api/analyze, static hosting, security headers
  service.py               demo-vs-live orchestration, retries, transcript limits
  providers/               Anthropic, Gemini, OpenAI-compatible adapters (+ base class)
  validation.py            schema + grounding checks on model output
  demo_analyzer.py         deterministic rule-based analyzer (Demo mode)
  prompts.py, schemas.py, config.py, errors.py
static/
  index.html styles.css    UI shell and styling (original Kanban look + dark mode)
  core.js                  all business logic (pure functions; unit-tested in Node)
  app.js                   rendering, routing, events, API client
  demo.js                  fictional sample meeting generator
tests/                     test_backend.py, core.test.js, ui.test.js (+ fixtures)
kanban_board.original.html backup of the pre-upgrade app
```

## Tests

```bash
pip install -r requirements.txt
npm install                # installs jsdom (UI tests only)
./run_tests.sh             # or run each part separately:
python3 -m pytest tests/test_backend.py -q
node --test tests/core.test.js
node --test tests/ui.test.js
```

Last run (all executed, all passing):

| Suite | What it covers | Result |
|---|---|---|
| `tests/test_backend.py` (pytest) | output validation, malformed/hallucinated AI output, owner/deadline handling, demo analyzer, provider adapters (mocked HTTP), rate-limit/timeout/auth errors, missing credentials, secrets never in responses or logs, request limits, security headers | **58 passed** |
| `tests/core.test.js` (node:test) | legacy-card migration, task CRUD/move/completion timestamps, save/reload, due-date and overdue rules, transcript validation, analysis parsing, edit/reject/approve, duplicate-approval prevention, metrics from real records, filters, traceability, export/import | **29 passed** |
| `tests/ui.test.js` (node:test) | real backend + real UI code in jsdom: legacy upgrade, the full demo workflow end-to-end, dashboard numbers vs. stored data, error/retry/offline handling, duplicate-submit guard, uploads, XSS/prompt-injection text, import/export, corrupted storage | **12 passed** |

Total: **99 tests, 0 failures.** As a sanity check, deliberately breaking the duplicate-approval guard and the overdue rule made the relevant tests fail.

## Implemented features

Meeting workspace (create/save/reopen, `.txt` upload, loading and error states, duplicate-submit guard, transcript limits) ·
structured analysis (summary, decisions with evidence and status, action items with owner/deadline/priority/evidence/confidence/flags, discussion notes, missing information) ·
secure backend proxy with provider adapters, timeouts, retry and rate-limit handling · labelled demo mode ·
human review and approval (edit/reject/restore/delete/add manually, bulk actions, idempotent approval) ·
extended task model (due date, timestamps, source meeting and evidence, completion time) ·
Kanban with drag-and-drop, keyboard move menu, search/filters, overdue/today/soon/unassigned/high-priority indicators ·
dashboard with 12 metrics, 5 charts, 7 filters, recent activity and a needs-attention list ·
meeting history, task ↔ meeting ↔ evidence traceability, preserved previous analyses ·
versioned storage with migration, export/import, safe handling of bad data · dark mode, responsive layout, accessible labels/focus/live regions ·
fictional sample-meeting generator.

## Known limitations

- **Not verified in a real browser.** UI behaviour was tested with jsdom (DOM emulation). Layout, visual polish, drag-and-drop with a real mouse, and mobile rendering have **not** been checked on actual devices. Please click through it once in Chrome or Safari before presenting.
- **Live AI path not exercised against real provider APIs** (see above). Model names and defaults may need adjusting for your account.
- Demo-mode analysis is rule-based: best with “Name: sentence” transcripts in English; it will miss or misread phrasing outside its patterns. It is for demonstration, not production use.
- Single-user, single-browser storage only. No accounts, sync, sharing or real-time collaboration; no Zoom/Meet/Teams/calendar integration; no audio transcription.
- Only plain `.txt` transcripts (no PDF/DOCX/VTT/SRT). Transcripts over 60,000 characters must be split.
- The request-size guard relies on the `Content-Length` header plus schema limits; there is no per-user rate limiting, authentication or HTTPS (bind to localhost, or put it behind a reverse proxy if you expose it).
- Live AI sends transcripts to the configured provider. Use only sample or authorised data (as the build-a-thon rules require).

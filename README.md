# AI Meeting Summary & Action Tracker

Meeting decisions and tasks often get lost in scattered notes and chat threads. This web app turns a meeting
transcript into structured, reviewable work: a summary, the decisions made, and action items with owners,
deadlines and the exact transcript sentence each one came from.

An AI model drafts the results, but a person reviews, edits and approves every item before it becomes a task.
Approved tasks go onto a Kanban board (Open, In Progress, Hold, Completed), and a dashboard shows what is
overdue and who owns what.

Built for the Tech Yuva × GDG Gurugram Build-A-Thon 2026 (PS-02).

## How it works

Transcript → AI analysis → Human review → Approved tasks → Kanban tracking → Progress dashboard

## Features

- Paste a transcript or upload a `.txt` file; get a summary, decisions and action items
- Flags missing owners and unclear deadlines instead of guessing
- Human review: edit, reject or approve every item before it becomes a task
- Every task links back to the transcript sentence it came from
- Kanban board with overdue, due-today and due-soon indicators
- Dashboard with filters (owner, priority, status, dates)
- Export and import your data as JSON
- Demo mode with no API key; live AI with Anthropic, Google Gemini or OpenAI-compatible models
- API keys stay on the server and never reach the browser
- 99 automated tests

## Quick start (Demo mode, no API key needed)

Requires Python 3.10 or newer.

Open the `meeting-tracker` folder first (the project lives inside it), then:

```bash
cd meeting-tracker
pip install -r requirements.txt
python3 run.py
```

Open http://127.0.0.1:8000. Click **Load Demo Meeting**, then **Analyze transcript**, review the action items,
approve them, and look at the **Kanban** and **Dashboard** tabs. Press Ctrl+C to stop the app.

If port 8000 is busy, run `PORT=8001 python3 run.py` and open http://127.0.0.1:8001.

## Using live AI (optional)

```bash
cp .env.example .env
```

Add one key to `.env` (never commit this file): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY`,
then restart the app. The badge at the top of the page shows which mode is active. `AI_MODEL` can override the
default model name. In live mode, transcripts are sent to the provider you configure.

## Tech stack

- Frontend: HTML, CSS and plain JavaScript (no build step)
- Backend: Python with FastAPI
- AI: pluggable adapters for Anthropic, Google Gemini and OpenAI-compatible models
- Storage: browser localStorage with a versioned schema and JSON backup
- Tests: pytest, the Node test runner and jsdom

## Run the tests

```bash
cd meeting-tracker
pip install -r requirements.txt
python3 -m pytest tests/test_backend.py -q     # 58 backend tests
npm install                                    # needs Node.js, for the other 41
./run_tests.sh
```

## Limitations

- Data is stored in your browser only: no shared storage, logins or sync between people
- No direct Teams or Zoom connection yet; you paste in a transcript
- Demo mode is rule-based, not AI, and works best with "Name: sentence" lines
- The live AI connection is covered by tests with simulated responses, not tested against real provider accounts here

## Roadmap

Shared database and team logins, Teams / Zoom / Slack integration, `.vtt` and audio transcripts,
due-date reminders, more languages.

## License

MIT

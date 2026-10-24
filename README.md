# AI-Meeting-Summary-and-Action-Tracker

A lightweight web app that turns meeting transcripts into:
- a short summary,
- extracted decisions,
- action items with owners and deadlines,
- a human approval step,
- a Kanban board,
- and a progress dashboard.

## Run locally

Because this is a static app, you can run it with any file server.

```bash
cd /home/runner/work/AI-Meeting-Summary-and-Action-Tracker/AI-Meeting-Summary-and-Action-Tracker
python -m http.server 8000
```

Then open: `http://localhost:8000/index.html`

## Example transcript format

Use natural lines such as:

- `Decision: We agreed to prioritize onboarding fixes this sprint.`
- `Anita will draft the onboarding checklist by 2026-11-05`
- `API documentation update - owner: Ravi, due: 2026-11-08`
- `Action: Follow up with design for button states`

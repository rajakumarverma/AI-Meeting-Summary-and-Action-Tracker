# 3-minute demo script

**Before you start (30 s, once):** `python run.py`, open http://127.0.0.1:8000, and use a clean browser profile or
Data & backup → *Clear all data*. Optional: set an API key first to demo live AI. Otherwise say “Demo mode” out loud; the app labels it too.

| Time | Do | Say |
|---|---|---|
| 0:00 | Dashboard (empty). | “Meeting decisions and action items get lost. This app turns a transcript into reviewed, tracked work. The dashboard is empty: nothing is hardcoded.” |
| 0:15 | Click **Load Demo Meeting**. Scroll the transcript. | “A fictional product sync with a few decisions, five action items, a blocker, and some deliberately messy bits: one task has no owner, one has a vague deadline.” |
| 0:30 | Point at the header badge and the privacy note, then click **Analyze transcript**. | “No key is configured, so this is clearly labelled Demo mode: rule-based, not AI. With a key it calls the model through our backend. The key never reaches the browser, and the output is validated before you see it.” |
| 0:50 | Show **Executive summary**, **Decisions** (confirmed badge + evidence), then **Discussion notes** and **Missing information**. | “Decisions must be explicit. Elena's ‘maybe a shorter tutorial’ was *not* turned into a decision; it landed in open questions.” |
| 1:10 | In **Action items**: show the red *Needs review* flags. Click **Show in transcript** on one. | “Every item keeps its source sentence, so each can be checked. Nothing is a task yet.” |
| 1:25 | Fix the unassigned item: owner = Priya Nair, add a due date. **Reject** the “sometime next week” item. | “People stay in control: edit owners and deadlines, reject what isn't real.” |
| 1:45 | Click **Approve all remaining**, confirm the warning dialog, then try the (now disabled) button again. | “Approve once, and it can't be duplicated.” |
| 1:55 | Go to **Kanban**. Point at the red *Overdue by N days* card, the *Unassigned* and high-priority chips, and “From meeting…”. Move one card with the ··· menu → In Progress; drag another to Completed. | “Tasks arrive in Open with owner, priority and due date. Drag to track progress; completing stamps a timestamp. The original board is unchanged.” |
| 2:20 | Go to **Dashboard**. Walk through the task tiles, status bar, completion rate and overdue-by-owner. Filter Owner = Marcus Lee, then reset. | “Every number comes from the saved records. Overdue excludes completed work, and here's who owns the overdue items.” |
| 2:40 | Back on Kanban, click “From meeting…” on the overdue card, then **Show in transcript**. | “Full traceability: task → meeting → the exact sentence it came from.” |
| 2:50 | Open **Data & backup**. | “Data lives in this browser only: export and import backups here. Honest limit: no team sync yet. That's our next step. Thank you!” |

**If something goes wrong:** the app works fully in Demo mode; *Load Demo Meeting* creates a fresh sample at any time; if the
server is down, the Kanban board and manual action items still work.

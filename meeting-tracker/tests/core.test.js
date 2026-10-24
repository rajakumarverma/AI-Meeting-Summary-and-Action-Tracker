'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../static/core.js');

const NOW = new Date(2026, 9, 24, 12, 0, 0); // Sat 24 Oct 2026 (local)
const at = (h) => new Date(2026, 9, 24, h, 0, 0);

// The exact card shape the ORIGINAL kanban_board.html persisted under "kanban_v3".
const LEGACY = [
  { id: 'a1', title: 'Weekly view', column: 'open', priority: 'Low', assignee: 'Alice' },
  { id: 'a2', title: 'Card view', column: 'open', priority: 'Medium', assignee: '' },
  { id: 'a3', title: 'Bug fix', column: 'open', priority: 'High', assignee: 'Bob' },
  { id: 'a4', title: 'Monthly view', column: 'inprogress', priority: 'Medium', assignee: 'Charlie' },
  { id: 'a5', title: 'Dashboard', column: 'hold', priority: 'Low', assignee: '' },
  { id: 'a6', title: 'Testimonials', column: 'completed', priority: 'Low', assignee: 'Charlie' }
];

function apiResult(over) {
  return Object.assign({
    mode: 'demo', provider: null, model: null, label: 'Demo mode (rule-based, not AI)', warnings: [],
    analysis: {
      meeting_summary: 'Summary text.', main_topics: ['Launch'], outcomes: [], unresolved: [],
      decisions: [{ description: 'Keep Nov 16', evidence: 'we decided to keep Nov 16', evidence_verified: true, topic: null, status: 'confirmed' }],
      action_items: [
        { title: 'Fix login crash', description: 'd', owner: 'Marcus Lee', due_date: '2026-10-21', due_text: 'by Oct 21', priority: 'High', topic: 'Launch', evidence: "I'll fix the login crash by Oct 21.", evidence_verified: true, confidence: 0.8, needs_review: false, needs_clarification: false, review_reasons: [] },
        { title: 'Confirm contract date', description: '', owner: 'Unassigned', due_date: null, due_text: null, priority: 'Medium', topic: null, evidence: 'Someone needs to confirm the contract date.', evidence_verified: true, confidence: 0.5, needs_review: true, needs_clarification: false, review_reasons: ['No clear owner was identified.'] },
        { title: 'Run regression tests', description: '', owner: 'Sam Okafor', due_date: null, due_text: 'sometime next week', priority: 'Medium', topic: null, evidence: "I'll run the regression tests sometime next week.", evidence_verified: true, confidence: 0.8, needs_review: true, needs_clarification: true, review_reasons: ['The deadline is unclear'] }
      ],
      discussion_points: [], risks: [], blockers: ['Crash blocks beta'], dependencies: [], open_questions: [], missing_information: []
    }
  }, over || {});
}
function stateWithMeeting() {
  let s = C.emptyState();
  const added = C.addMeeting(s, { title: 'Sync', startsAt: '2026-10-19T10:00', participants: ['Marcus Lee'], project: 'Launch', transcript: "Marcus: I'll fix the login crash by Oct 21." }, NOW);
  s = C.recordAnalysis(added.state, added.meeting.id, apiResult(), NOW);
  return { s, id: added.meeting.id };
}

/* ------------------------------------------------ migration: existing Kanban cards survive */
test('legacy kanban_v3 cards survive the upgrade with every original field intact', () => {
  const r = C.migrate(JSON.parse(JSON.stringify(LEGACY)), NOW);
  assert.equal(r.migratedFrom, 'kanban_v3');
  assert.equal(r.state.schemaVersion, 2);
  assert.equal(r.state.tasks.length, LEGACY.length);
  LEGACY.forEach((old, i) => {
    const t = r.state.tasks[i];
    assert.equal(t.id, old.id); assert.equal(t.title, old.title); assert.equal(t.column, old.column);
    assert.equal(t.priority, old.priority); assert.equal(t.assignee, old.assignee);
    assert.equal(t.dueDate, null); assert.equal(t.sourceMeetingId, null);
    assert.ok(t.createdAt && t.updatedAt);
  });
  assert.ok(r.state.tasks.find((t) => t.id === 'a6').completedAt, 'legacy completed cards get a completion timestamp');
  assert.equal(r.state.tasks.find((t) => t.id === 'a1').completedAt, null);
});
test('migration does not mutate its input (legacy data stays untouched)', () => {
  const input = JSON.parse(JSON.stringify(LEGACY)); const before = JSON.stringify(input);
  C.migrate(input, NOW);
  assert.equal(JSON.stringify(input), before);
});
test('malformed / missing stored data is handled safely', () => {
  for (const bad of [null, undefined]) { const r = C.migrate(bad, NOW); assert.deepEqual(r.state.tasks, []); assert.equal(r.warnings.length, 0); }
  for (const bad of ['garbage', 42, true]) { const r = C.migrate(bad, NOW); assert.deepEqual(r.state.tasks, []); assert.equal(r.warnings.length, 1); }
  const r = C.migrate([null, 5, 'x', { id: 'ok', title: 'Valid', column: 'weird', priority: 'extreme', dueDate: '2026-02-31' }], NOW);
  assert.equal(r.state.tasks.length, 1);
  const t = r.state.tasks[0];
  assert.equal(t.column, 'open'); assert.equal(t.priority, 'Medium'); assert.equal(t.dueDate, null);
  assert.ok(r.warnings[0].includes('3 unreadable'));
});
test('duplicate ids are repaired and dangling approved links go back to draft', () => {
  const { s, id } = stateWithMeeting();
  const approved = C.approveActionItems(s, id, 'all', NOW).state;
  const broken = JSON.parse(JSON.stringify(approved));
  broken.tasks = []; // simulate lost tasks
  const r = C.migrate(broken, NOW);
  const items = r.state.meetings[0].analysis.actionItems;
  assert.ok(items.every((i) => i.status === 'draft' && i.taskId === null));
  const dup = C.migrate([{ id: 'x', title: 'A' }, { id: 'x', title: 'B' }], NOW);
  assert.notEqual(dup.state.tasks[0].id, dup.state.tasks[1].id);
});

/* ------------------------------------------------ tasks: create / edit / delete / move / persist */
test('create, edit and delete tasks (manual tasks keep working)', () => {
  let s = C.migrate(LEGACY, NOW).state;
  const added = C.addTask(s, { title: '  New task  ', priority: 'High', assignee: 'Dana', dueDate: '2026-10-30' }, at(13));
  s = added.state;
  assert.equal(added.task.title, 'New task'); assert.equal(added.task.column, 'open');
  assert.equal(added.task.dueDate, '2026-10-30'); assert.equal(added.task.createdAt, at(13).toISOString());
  assert.equal(added.task.sourceMeetingId, null);
  s = C.updateTask(s, added.task.id, { title: 'Renamed', priority: 'Low', assignee: '', dueDate: null, description: 'details' }, at(14));
  const t = s.tasks.find((x) => x.id === added.task.id);
  assert.equal(t.title, 'Renamed'); assert.equal(t.priority, 'Low'); assert.equal(t.assignee, ''); assert.equal(t.dueDate, null);
  assert.equal(t.updatedAt, at(14).toISOString()); assert.equal(t.createdAt, at(13).toISOString());
  s = C.deleteTask(s, added.task.id, NOW);
  assert.equal(s.tasks.find((x) => x.id === added.task.id), undefined);
  assert.equal(s.tasks.length, LEGACY.length);
  assert.throws(() => C.addTask(s, { title: '   ' }, NOW), /title/);
  assert.throws(() => C.updateTask(s, 'a1', { title: '' }, NOW), /title/);
});
test('moving tasks persists the column and records completion timestamps', () => {
  let s = C.migrate(LEGACY, NOW).state;
  s = C.moveTask(s, 'a1', 'inprogress', at(9)); assert.equal(s.tasks.find((t) => t.id === 'a1').column, 'inprogress');
  s = C.moveTask(s, 'a1', 'hold', at(10)); assert.equal(s.tasks.find((t) => t.id === 'a1').column, 'hold');
  s = C.moveTask(s, 'a1', 'completed', at(11));
  let t = s.tasks.find((x) => x.id === 'a1');
  assert.equal(t.column, 'completed'); assert.equal(t.completedAt, at(11).toISOString());
  s = C.moveTask(s, 'a1', 'open', at(12));
  t = s.tasks.find((x) => x.id === 'a1');
  assert.equal(t.completedAt, null, 'reopening clears the completion timestamp');
  assert.equal(C.moveTask(s, 'a1', 'nonsense', NOW), s, 'invalid column is ignored');
  assert.equal(C.moveTask(s, 'missing', 'open', NOW), s);
  const kinds = s.activity.map((a) => a.type);
  assert.deepEqual(kinds.slice(0, 4), ['reopened', 'completed', 'moved', 'moved']);
});
test('state survives a save/reload round trip (JSON) unchanged', () => {
  let { s } = stateWithMeeting();
  s = C.approveActionItems(s, s.meetings[0].id, 'all', NOW).state;
  s = C.moveTask(s, s.tasks[0].id, 'completed', NOW);
  const reloaded = C.migrate(JSON.parse(JSON.stringify(s)), NOW);
  assert.equal(reloaded.migratedFrom, null);
  assert.deepEqual(reloaded.state.tasks, s.tasks);
  assert.deepEqual(reloaded.state.meetings, s.meetings);
  assert.deepEqual(reloaded.state.activity, s.activity);
});

/* ------------------------------------------------ due dates */
test('due-date states and overdue calculation', () => {
  const mk = (dueDate, column = 'open') => ({ dueDate, column });
  assert.equal(C.dueState(mk('2026-10-23'), NOW), 'overdue');
  assert.equal(C.dueState(mk('2026-10-24'), NOW), 'today', 'due today is NOT overdue');
  assert.equal(C.dueState(mk('2026-10-25'), NOW), 'soon');
  assert.equal(C.dueState(mk('2026-10-27'), NOW), 'soon');
  assert.equal(C.dueState(mk('2026-10-28'), NOW), 'later');
  assert.equal(C.dueState(mk(null), NOW), null);
  assert.equal(C.dueState(mk('2026-10-01', 'completed'), NOW), null, 'completed tasks are never overdue');
  assert.equal(C.isOverdue(mk('2026-10-01', 'hold'), NOW), true, 'Hold tasks past their deadline ARE overdue (documented)');
  assert.equal(C.isOverdue(mk('2026-10-01', 'inprogress'), NOW), true);
  assert.equal(C.dueState(mk('not-a-date'), NOW), null);
});
test('due labels, month/year boundaries and date formatting', () => {
  assert.equal(C.dueLabel({ dueDate: '2026-10-22', column: 'open' }, NOW), 'Overdue by 2 days');
  assert.equal(C.dueLabel({ dueDate: '2026-10-23', column: 'open' }, NOW), 'Overdue by 1 day');
  assert.equal(C.dueLabel({ dueDate: '2026-10-24', column: 'open' }, NOW), 'Due today');
  assert.equal(C.dueLabel({ dueDate: '2026-10-25', column: 'open' }, NOW), 'Due tomorrow');
  assert.equal(C.dueLabel({ dueDate: '2026-10-27', column: 'open' }, NOW), 'Due in 3 days');
  assert.equal(C.dueLabel({ dueDate: '2026-12-01', column: 'open' }, NOW), 'Due Dec 1, 2026');
  assert.equal(C.dayDiff('2027-01-01', '2026-12-31'), 1);
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.formatDateTime('2026-10-19T10:00'), 'Oct 19, 2026, 10:00');
  assert.ok(!C.isValidISODate('2026-02-30'));
});

/* ------------------------------------------------ transcript validation */
test('empty / short / long transcripts and bad uploads are rejected with guidance', () => {
  assert.equal(C.validateTranscript('').ok, false);
  assert.equal(C.validateTranscript('   \n\t ').ok, false);
  assert.match(C.validateTranscript('').error, /Paste or upload/);
  assert.match(C.validateTranscript('too short').error, /too short/);
  assert.match(C.validateTranscript('x'.repeat(70000)).error, /limit is 60,000/);
  const ok = C.validateTranscript('Priya: hello everyone\r\nMarcus: hi there friends');
  assert.equal(ok.ok, true); assert.ok(!ok.text.includes('\r'));
  assert.equal(C.validateUpload({ name: 'notes.pdf', size: 100 }).ok, false);
  assert.match(C.validateUpload({ name: 'notes.exe', size: 100 }).error, /\.txt/);
  assert.equal(C.validateUpload({ name: 'big.txt', size: 2 * 1024 * 1024 }).ok, false);
  assert.equal(C.validateUpload({ name: 'empty.txt', size: 0 }).ok, false);
  assert.equal(C.validateUpload({ name: 'ok.TXT', size: 500 }).ok, true);
  assert.equal(C.looksLikeText('plain text here'), true);
  assert.equal(C.looksLikeText('bin\u0000ary'), false);
});

/* ------------------------------------------------ analysis parsing */
test('a valid AI/demo response becomes drafts with ids and nothing is auto-approved', () => {
  const { s } = stateWithMeeting();
  const m = s.meetings[0];
  assert.equal(m.status, 'analyzed'); assert.equal(m.analysis.mode, 'demo');
  assert.equal(m.analysis.actionItems.length, 3);
  assert.ok(m.analysis.actionItems.every((i) => i.status === 'draft' && i.taskId === null && i.id));
  assert.equal(s.tasks.length, 0, 'no task exists before approval');
  assert.equal(m.analysis.decisions[0].status, 'confirmed');
  assert.equal(m.analysis.actionItems[0].dueDate, '2026-10-21');
});
test('malformed API responses are rejected without touching saved data', () => {
  let s = C.emptyState(); const a = C.addMeeting(s, { title: 'M', transcript: 'x'.repeat(30) }, NOW);
  for (const bad of [null, {}, { analysis: null }, { analysis: 'text' }, { analysis: { meeting_summary: 'x' } }, { analysis: { action_items: {}, decisions: [] } }]) {
    assert.throws(() => C.recordAnalysis(a.state, a.meeting.id, bad, NOW), /unexpected|missing/i);
  }
  assert.throws(() => C.recordAnalysis(a.state, 'nope', apiResult(), NOW), /not found/);
  const failed = C.recordAnalysisFailure(a.state, a.meeting.id, 'Server said no', NOW);
  assert.equal(failed.meetings[0].status, 'failed'); assert.equal(failed.meetings[0].lastError, 'Server said no');
});
test('missing owner and deadline are preserved as Unassigned / empty and flagged', () => {
  const { s } = stateWithMeeting();
  const [fix, contract, regression] = s.meetings[0].analysis.actionItems;
  assert.equal(contract.owner, 'Unassigned'); assert.equal(contract.dueDate, null); assert.equal(contract.needsReview, true);
  assert.equal(regression.dueDate, null); assert.equal(regression.dueText, 'sometime next week'); assert.equal(regression.needsClarification, true);
  assert.equal(fix.needsReview, false);
});
test('re-analysis keeps the previous analysis in history and flags possible duplicates of approved tasks', () => {
  let { s, id } = stateWithMeeting();
  const firstId = s.meetings[0].analysis.id;
  s = C.approveActionItems(s, id, [s.meetings[0].analysis.actionItems[0].id], NOW).state;
  s = C.recordAnalysis(s, id, apiResult({ label: 'second run' }), NOW);
  const m = s.meetings[0];
  assert.equal(m.analysisHistory.length, 1); assert.equal(m.analysisHistory[0].id, firstId);
  assert.equal(m.analysisHistory[0].actionItems[0].status, 'approved', 'old analysis is preserved intact');
  const dup = m.analysis.actionItems.find((i) => i.title === 'Fix login crash');
  assert.equal(dup.status, 'draft');
  assert.ok(dup.reviewReasons.some((r) => /already approved/.test(r)));
  assert.equal(s.tasks.length, 1, 're-analysis never creates tasks by itself');
});

/* ------------------------------------------------ review: edit / reject / approve */
test('editing an extracted action item (owner, deadline, title, priority) works and marks it reviewed', () => {
  let { s, id } = stateWithMeeting();
  const target = s.meetings[0].analysis.actionItems[1];
  s = C.updateActionItem(s, id, target.id, { owner: 'Priya Nair', dueDate: '2026-11-02', title: 'Confirm payment contract renewal', priority: 'High', description: 'Check the date' }, NOW);
  const it = C.getItem(s, id, target.id);
  assert.equal(it.owner, 'Priya Nair'); assert.equal(it.dueDate, '2026-11-02'); assert.equal(it.priority, 'High');
  assert.equal(it.title, 'Confirm payment contract renewal'); assert.equal(it.reviewed, true); assert.equal(it.status, 'draft');
  s = C.updateActionItem(s, id, target.id, { dueDate: 'garbage', owner: '' }, NOW);
  assert.equal(C.getItem(s, id, target.id).dueDate, null); assert.equal(C.getItem(s, id, target.id).owner, 'Unassigned');
});
test('rejecting an action item prevents approval; it can be restored; duplicates can be deleted', () => {
  let { s, id } = stateWithMeeting();
  const [a, b, c] = s.meetings[0].analysis.actionItems;
  s = C.rejectActionItem(s, id, a.id, NOW);
  assert.equal(C.getItem(s, id, a.id).status, 'rejected');
  const r = C.approveActionItems(s, id, 'all', NOW);
  assert.equal(r.created.length, 2); assert.equal(r.state.tasks.some((t) => t.title === a.title), false);
  assert.equal(C.getItem(r.state, id, a.id).status, 'rejected');
  s = C.restoreActionItem(s, id, a.id, NOW); assert.equal(C.getItem(s, id, a.id).status, 'draft');
  s = C.deleteActionItem(s, id, b.id); assert.equal(C.getItem(s, id, b.id), null);
  assert.equal(C.getItem(s, id, c.id).status, 'draft');
});
test('approving creates Open tasks with mapped fields, source meeting and evidence', () => {
  let { s, id } = stateWithMeeting();
  const first = s.meetings[0].analysis.actionItems[0];
  const r = C.approveActionItems(s, id, [first.id], at(15));
  assert.equal(r.created.length, 1); assert.equal(r.state.tasks.length, 1);
  const t = r.state.tasks[0];
  assert.equal(t.title, 'Fix login crash'); assert.equal(t.column, 'open'); assert.equal(t.assignee, 'Marcus Lee');
  assert.equal(t.priority, 'High'); assert.equal(t.dueDate, '2026-10-21'); assert.equal(t.project, 'Launch');
  assert.equal(t.sourceMeetingId, id); assert.equal(t.sourceActionId, first.id);
  assert.equal(t.sourceEvidence, "I'll fix the login crash by Oct 21."); assert.equal(t.createdAt, at(15).toISOString());
  assert.equal(C.getItem(r.state, id, first.id).status, 'approved'); assert.equal(C.getItem(r.state, id, first.id).taskId, t.id);
  const unowned = C.approveActionItems(r.state, id, [s.meetings[0].analysis.actionItems[1].id], NOW).state.tasks[1];
  assert.equal(unowned.assignee, '', 'Unassigned maps to an empty assignee');
  assert.equal(r.state.activity[0].type, 'approved');
});
test('duplicate approval is prevented (double click, repeated bulk approve, stale ids)', () => {
  let { s, id } = stateWithMeeting();
  const ids = s.meetings[0].analysis.actionItems.map((i) => i.id);
  const once = C.approveActionItems(s, id, ids, NOW);
  assert.equal(once.state.tasks.length, 3);
  const twice = C.approveActionItems(once.state, id, ids, NOW);
  assert.equal(twice.state.tasks.length, 3); assert.equal(twice.created.length, 0); assert.equal(twice.skipped, 3);
  assert.equal(C.approveActionItems(twice.state, id, 'all', NOW).state.tasks.length, 3);
  // even if the item status was lost, a task with the same sourceActionId blocks a duplicate
  const tampered = JSON.parse(JSON.stringify(once.state));
  tampered.meetings[0].analysis.actionItems[0].status = 'draft';
  assert.equal(C.approveActionItems(tampered, id, [ids[0]], NOW).state.tasks.length, 3);
  // approved items are locked against edits
  const locked = C.updateActionItem(once.state, id, ids[0], { title: 'Hacked' }, NOW);
  assert.equal(C.getItem(locked, id, ids[0]).title, 'Fix login crash');
  assert.equal(C.rejectActionItem(once.state, id, ids[0], NOW), once.state);
});
test('deleting a task returns its source item to draft so it can be re-approved without a dangling link', () => {
  let { s, id } = stateWithMeeting();
  const itemId = s.meetings[0].analysis.actionItems[0].id;
  s = C.approveActionItems(s, id, [itemId], NOW).state;
  s = C.deleteTask(s, s.tasks[0].id, NOW);
  assert.equal(C.getItem(s, id, itemId).status, 'draft'); assert.equal(C.getItem(s, id, itemId).taskId, null);
  assert.equal(C.approveActionItems(s, id, [itemId], NOW).state.tasks.length, 1);
});
test('manual action items can be added to a meeting and approved', () => {
  let s = C.emptyState(); const a = C.addMeeting(s, { title: 'Manual', transcript: '' }, NOW);
  const r = C.addManualActionItem(a.state, a.meeting.id, { title: 'Call vendor', owner: 'Sam', priority: 'High' }, NOW);
  assert.equal(r.item.manual, true);
  const approved = C.approveActionItems(r.state, a.meeting.id, [r.item.id], NOW);
  assert.equal(approved.state.tasks[0].assignee, 'Sam');
  assert.throws(() => C.addManualActionItem(a.state, a.meeting.id, { title: ' ' }, NOW), /title/);
});
test('bulk approval can warn about unresolved review flags', () => {
  let { s, id } = stateWithMeeting();
  assert.equal(C.unresolvedFlagCount(s.meetings[0]), 2);
  const flagged = s.meetings[0].analysis.actionItems[1].id;
  s = C.markReviewed(s, id, flagged, NOW);
  assert.equal(C.unresolvedFlagCount(s.meetings[0]), 1);
});

/* ------------------------------------------------ metrics from real records */
function metricsFixture() {
  let s = C.emptyState();
  const add = (f, extra) => { const r = C.addTask(s, f, NOW, extra); s = r.state; return r.task; };
  add({ title: 'Overdue open', assignee: 'Ann', dueDate: '2026-10-20', priority: 'High' });
  const hold = add({ title: 'Overdue hold', assignee: 'Ann', dueDate: '2026-10-21', priority: 'Low' });
  const done = add({ title: 'Done late', assignee: 'Bob', dueDate: '2026-10-01', priority: 'Medium' });
  add({ title: 'Due today', assignee: 'Bob', dueDate: '2026-10-24', priority: 'Medium' });
  add({ title: 'No owner', assignee: '', priority: 'High' });
  add({ title: 'Inprogress', assignee: 'Cy' });
  s = C.moveTask(s, hold.id, 'hold', NOW); s = C.moveTask(s, done.id, 'completed', NOW);
  return s;
}
test('dashboard metrics are computed from actual records', () => {
  const s = metricsFixture(); const m = C.computeMetrics(s, {}, NOW);
  assert.equal(m.tasks.total, 6); assert.equal(m.tasks.open, 4); assert.equal(m.tasks.hold, 1); assert.equal(m.tasks.completed, 1);
  assert.equal(m.tasks.overdue, 2, 'completed task is not counted; hold task is');
  assert.equal(m.tasks.dueToday, 1); assert.equal(m.tasks.unassigned, 1);
  assert.equal(m.completionRate, 17);
  assert.deepEqual(m.byPriority, { High: 2, Medium: 3, Low: 1 });
  assert.equal(m.byOwner.find((r) => r.owner === 'Ann').overdue, 2);
  assert.deepEqual(m.overdueByOwner.map((r) => [r.owner, r.overdue]), [['Ann', 2]]);
  assert.equal(m.overdueTasks[0].title, 'Overdue open');
  assert.ok(m.recentActivity.length > 0 && m.recentActivity.length <= 8);
  const changed = C.moveTask(s, s.tasks[0].id, 'completed', NOW);
  assert.equal(C.computeMetrics(changed, {}, NOW).tasks.overdue, 1, 'metrics follow the data, not hardcoded numbers');
});
test('dashboard filters (owner, priority, status, due range, project, meeting) narrow the metrics', () => {
  const s = metricsFixture();
  assert.equal(C.computeMetrics(s, { owner: 'Ann' }, NOW).tasks.total, 2);
  assert.equal(C.computeMetrics(s, { owner: 'Unassigned' }, NOW).tasks.total, 1);
  assert.equal(C.computeMetrics(s, { priority: 'High' }, NOW).tasks.total, 2);
  assert.equal(C.computeMetrics(s, { status: 'hold' }, NOW).tasks.total, 1);
  assert.equal(C.computeMetrics(s, { dueFrom: '2026-10-20', dueTo: '2026-10-21' }, NOW).tasks.total, 2);
  assert.equal(C.computeMetrics(s, { dueFrom: '2026-12-01' }, NOW).tasks.total, 0);
  assert.equal(C.computeMetrics(s, { meetingId: 'nope' }, NOW).tasks.total, 0);
  assert.equal(C.filterTasks(s.tasks, {}, NOW, 'inprog').length, 1);
});
test('empty dataset yields zeros without errors', () => {
  const m = C.computeMetrics(C.emptyState(), {}, NOW);
  assert.equal(m.tasks.total, 0); assert.equal(m.completionRate, 0); assert.deepEqual(m.byOwner, []); assert.deepEqual(m.recentActivity, []);
  assert.equal(m.meetings.analyzed, 0);
});
test('meeting metrics count decisions, extracted and approved action items', () => {
  let { s, id } = stateWithMeeting();
  let m = C.computeMetrics(s, {}, NOW).meetings;
  assert.deepEqual(m, { analyzed: 1, decisions: 1, actionItemsExtracted: 3, actionItemsApproved: 0 });
  s = C.approveActionItems(s, id, [s.meetings[0].analysis.actionItems[0].id], NOW).state;
  s = C.addManualActionItem(s, id, { title: 'Manual one' }, NOW).state;
  m = C.computeMetrics(s, {}, NOW).meetings;
  assert.equal(m.actionItemsExtracted, 3, 'manual items are not "extracted"'); assert.equal(m.actionItemsApproved, 1);
  assert.equal(C.computeMetrics(s, { meetingId: id }, NOW).tasks.total, 1);
});

/* ------------------------------------------------ traceability */
test('tasks link back to their meeting and evidence; evidence can be located in the transcript', () => {
  let { s, id } = stateWithMeeting();
  s = C.approveActionItems(s, id, [s.meetings[0].analysis.actionItems[0].id], NOW).state;
  const task = s.tasks[0];
  const meeting = C.findMeeting(s, task.sourceMeetingId);
  assert.equal(meeting.title, 'Sync');
  assert.equal(C.tasksForMeeting(s, id)[0].id, task.id);
  const parts = C.highlightParts(meeting.transcript, task.sourceEvidence);
  assert.equal(parts.length, 3); assert.equal(parts[1].mark, true); assert.equal(parts[1].text, task.sourceEvidence);
  assert.equal(C.highlightParts('nothing relevant', 'not present anywhere'), null);
  assert.equal(C.highlightParts('', 'x'), null);
  assert.equal(C.highlightParts('Say hello. And goodbye now.', 'say hello... and goodbye now').length, 3);
});
test('HTML in transcripts/titles is escaped', () => {
  assert.equal(C.esc('<img src=x onerror=alert(1)> "q" & \'s\''), '&lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &amp; &#39;s&#39;');
});

/* ------------------------------------------------ meetings */
test('meeting CRUD and duplicate-transcript detection', () => {
  let s = C.emptyState();
  const a = C.addMeeting(s, { title: 'A', transcript: 'Priya: hello there everyone, welcome.' }, NOW); s = a.state;
  const b = C.addMeeting(s, { title: 'B', transcript: '  priya: HELLO there   everyone, welcome. ' }, NOW); s = b.state;
  assert.equal(C.findDuplicateMeeting(s, b.meeting.transcript, b.meeting.id).id, a.meeting.id);
  assert.equal(C.findDuplicateMeeting(s, 'completely different text here', null), null);
  s = C.updateMeeting(s, a.meeting.id, { title: 'Renamed', participants: ['X', 'Y'], project: 'P', startsAt: '2026-10-19T09:30' }, NOW);
  assert.equal(s.meetings[0].title, 'Renamed'); assert.deepEqual(s.meetings[0].participants, ['X', 'Y']); assert.equal(s.meetings[0].startsAt, '2026-10-19T09:30');
  s = C.deleteMeeting(s, a.meeting.id); assert.equal(s.meetings.length, 1);
  assert.deepEqual(C.parseList('Ann, Bob;ann\nCy'), ['Ann', 'Bob', 'Cy']);
  assert.deepEqual(C.speakersOf('Priya Nair: hi\nMarcus: yo\nnote without speaker\nPriya Nair: again'), ['Priya Nair', 'Marcus']);
});

/* ------------------------------------------------ export / import */
test('export then import restores everything; invalid imports are rejected with reasons', () => {
  let { s, id } = stateWithMeeting();
  s = C.approveActionItems(s, id, 'all', NOW).state;
  const exported = C.exportData(s, NOW);
  assert.equal(exported.app, C.APP_ID); assert.equal(exported.schemaVersion, 2);
  const r = C.parseImport(JSON.stringify(exported), NOW);
  assert.equal(r.ok, true); assert.deepEqual(r.state.tasks, s.tasks); assert.deepEqual(r.state.meetings, s.meetings);
  assert.deepEqual(r.counts, { tasks: 3, meetings: 1 });
  assert.equal(C.parseImport('not json', NOW).ok, false);
  assert.equal(C.parseImport('{"hello":1}', NOW).ok, false);
  assert.equal(C.parseImport(JSON.stringify({ app: C.APP_ID, schemaVersion: 99, data: { tasks: [], meetings: [] } }), NOW).ok, false);
  assert.equal(C.parseImport(JSON.stringify({ app: C.APP_ID, schemaVersion: 2, data: { tasks: 'x', meetings: [] } }), NOW).ok, false);
  const legacy = C.parseImport(JSON.stringify(LEGACY), NOW);
  assert.equal(legacy.ok, true); assert.equal(legacy.state.tasks.length, LEGACY.length);
  const partial = C.parseImport(JSON.stringify({ app: C.APP_ID, schemaVersion: 2, data: { tasks: [{ title: 'ok' }, 7], meetings: [] } }), NOW);
  assert.equal(partial.ok, true); assert.equal(partial.state.tasks.length, 1); assert.ok(partial.warnings.some((w) => /skipped/.test(w)));
});

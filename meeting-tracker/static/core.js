/* core.js — pure application logic (no DOM). Works in the browser (window.Core) and in Node (require).
 *
 * Data model (schemaVersion 2), persisted by app.js under localStorage key "meeting_tracker_v2":
 *   { schemaVersion, tasks[], meetings[], activity[] }
 * The original Kanban app stored a plain array of cards under "kanban_v3"; migrate() upgrades it losslessly
 * and the legacy key is never modified.
 *
 * Every mutating function is pure: (state, ...args, now) -> new state. `now` is injectable for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 2;
  var STORAGE_KEY = 'meeting_tracker_v2';
  var LEGACY_KEY = 'kanban_v3';
  var APP_ID = 'ai-meeting-action-tracker';
  var COLUMNS = [
    { id: 'open', label: 'Open' },
    { id: 'inprogress', label: 'In Progress' },
    { id: 'hold', label: 'Hold' },
    { id: 'completed', label: 'Completed' }
  ];
  var COLUMN_IDS = COLUMNS.map(function (c) { return c.id; });
  var PRIORITIES = ['Low', 'Medium', 'High'];
  var UNASSIGNED = 'Unassigned';
  var DUE_SOON_DAYS = 3;
  var MAX_TRANSCRIPT_CHARS = 60000;
  var MIN_TRANSCRIPT_CHARS = 20;
  var MAX_UPLOAD_BYTES = 1024 * 1024;
  var MAX_ACTIVITY = 200;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ------------------------------------------------------------------ small helpers */
  function genId() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v, max) { return (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max || 5000); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISODate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowISO(now) { return (now || new Date()).toISOString(); }
  function isValidISODate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var p = v.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function dayDiff(isoA, isoB) { // whole days from B to A (A - B)
    var a = isoA.split('-').map(Number), b = isoB.split('-').map(Number);
    return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
  }
  function addDays(iso, n) {
    var p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function formatDate(iso) {
    if (!isValidISODate(iso)) return '';
    var p = iso.split('-').map(Number);
    return MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0];
  }
  function formatDateTime(local) { // "2026-10-19T10:00" -> "Oct 19, 2026, 10:00"
    if (typeof local !== 'string' || !isValidISODate(local.slice(0, 10))) return '';
    var t = /T(\d{2}:\d{2})/.exec(local);
    return formatDate(local.slice(0, 10)) + (t ? ', ' + t[1] : '');
  }
  function formatTimestamp(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function hashText(s) { // djb2 over a normalised transcript, used only to spot duplicate submissions
    var t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(), h = 5381;
    for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16) + ':' + t.length;
  }
  function normTitle(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function ownerOf(task) { return task && task.assignee ? task.assignee : UNASSIGNED; }
  function pickPriority(p) {
    var m = { low: 'Low', medium: 'Medium', high: 'High' }[String(p || '').toLowerCase()];
    return m || 'Medium';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ sanitising / migration */
  function emptyState() { return { schemaVersion: SCHEMA_VERSION, tasks: [], meetings: [], activity: [] }; }

  function sanitizeTask(raw, nowStr) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var column = COLUMN_IDS.indexOf(raw.column) >= 0 ? raw.column : 'open';
    var created = typeof raw.createdAt === 'string' && !isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : nowStr;
    var updated = typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : created;
    var completed = typeof raw.completedAt === 'string' && !isNaN(Date.parse(raw.completedAt)) ? raw.completedAt : null;
    if (column === 'completed' && !completed) completed = updated;
    if (column !== 'completed') completed = null;
    return {
      id: str(raw.id, 60) || genId(),
      title: str(raw.title, 200) || '(untitled task)',
      description: str(raw.description, 2000),
      column: column,
      priority: pickPriority(raw.priority),
      assignee: str(raw.assignee, 120) === UNASSIGNED ? '' : str(raw.assignee, 120),
      project: str(raw.project, 200),
      dueDate: isValidISODate(raw.dueDate) ? raw.dueDate : null,
      createdAt: created, updatedAt: updated, completedAt: completed,
      sourceMeetingId: str(raw.sourceMeetingId, 60) || null,
      sourceActionId: str(raw.sourceActionId, 60) || null,
      sourceEvidence: str(raw.sourceEvidence, 1500) || null
    };
  }

  function strList(v, max) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim().slice(0, 700); }).slice(0, max || 60) : [];
  }

  function sanitizeItem(raw, nowStr) {
    if (!raw || typeof raw !== 'object') return null;
    var status = ['draft', 'approved', 'rejected'].indexOf(raw.status) >= 0 ? raw.status : 'draft';
    return {
      id: str(raw.id, 60) || genId(),
      title: str(raw.title, 200),
      description: str(raw.description, 1500),
      owner: str(raw.owner, 120) || UNASSIGNED,
      dueDate: isValidISODate(raw.dueDate) ? raw.dueDate : null,
      dueText: str(raw.dueText, 120) || null,
      priority: pickPriority(raw.priority),
      topic: str(raw.topic, 200) || null,
      evidence: str(raw.evidence, 1500),
      evidenceVerified: !!raw.evidenceVerified,
      confidence: typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null,
      needsReview: !!raw.needsReview,
      needsClarification: !!raw.needsClarification,
      reviewReasons: strList(raw.reviewReasons, 20),
      reviewed: !!raw.reviewed,
      manual: !!raw.manual,
      status: status,
      taskId: status === 'approved' ? (str(raw.taskId, 60) || null) : null,
      updatedAt: str(raw.updatedAt, 40) || nowStr
    };
  }

  function sanitizeAnalysis(raw, nowStr) {
    if (!raw || typeof raw !== 'object') return null;
    var seen = {};
    var items = (Array.isArray(raw.actionItems) ? raw.actionItems : []).map(function (i) { return sanitizeItem(i, nowStr); })
      .filter(function (i) { if (!i || seen[i.id]) return false; seen[i.id] = true; return true; });
    return {
      id: str(raw.id, 60) || genId(),
      mode: raw.mode === 'ai' ? 'ai' : 'demo',
      provider: str(raw.provider, 60) || null, model: str(raw.model, 100) || null,
      label: str(raw.label, 160),
      generatedAt: str(raw.generatedAt, 40) || nowStr,
      transcriptHash: str(raw.transcriptHash, 60),
      summary: str(raw.summary, 4000),
      mainTopics: strList(raw.mainTopics, 12), outcomes: strList(raw.outcomes, 20), unresolved: strList(raw.unresolved, 20),
      decisions: (Array.isArray(raw.decisions) ? raw.decisions : []).filter(function (d) { return d && typeof d === 'object' && str(d.description); })
        .map(function (d) {
          return {
            id: str(d.id, 60) || genId(), description: str(d.description, 1000), evidence: str(d.evidence, 1500),
            evidenceVerified: !!d.evidenceVerified, topic: str(d.topic, 200) || null,
            status: d.status === 'confirmed' ? 'confirmed' : 'needs_clarification'
          };
        }),
      actionItems: items,
      discussionPoints: strList(raw.discussionPoints), risks: strList(raw.risks), blockers: strList(raw.blockers),
      dependencies: strList(raw.dependencies), openQuestions: strList(raw.openQuestions),
      missingInformation: strList(raw.missingInformation),
      warnings: strList(raw.warnings, 20)
    };
  }

  function sanitizeMeeting(raw, nowStr) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var analysis = sanitizeAnalysis(raw.analysis, nowStr);
    return {
      id: str(raw.id, 60) || genId(),
      title: str(raw.title, 200) || 'Untitled meeting',
      startsAt: typeof raw.startsAt === 'string' && isValidISODate(raw.startsAt.slice(0, 10)) ? raw.startsAt.slice(0, 16) : '',
      participants: strList(raw.participants, 50),
      project: str(raw.project, 200),
      transcript: typeof raw.transcript === 'string' ? raw.transcript.slice(0, MAX_TRANSCRIPT_CHARS * 2) : '',
      status: analysis ? 'analyzed' : (raw.status === 'failed' ? 'failed' : 'draft'),
      analysis: analysis,
      analysisHistory: (Array.isArray(raw.analysisHistory) ? raw.analysisHistory : []).map(function (a) { return sanitizeAnalysis(a, nowStr); }).filter(Boolean).slice(0, 20),
      isDemo: !!raw.isDemo,
      lastError: str(raw.lastError, 500) || null,
      createdAt: str(raw.createdAt, 40) || nowStr,
      updatedAt: str(raw.updatedAt, 40) || nowStr
    };
  }

  function sanitizeActivity(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.at !== 'string') return null;
    return { id: str(raw.id, 60) || genId(), at: raw.at, type: str(raw.type, 20), taskId: str(raw.taskId, 60),
      taskTitle: str(raw.taskTitle, 200), from: str(raw.from, 20) || null, to: str(raw.to, 20) || null };
  }

  /** Upgrade whatever was found in storage (legacy array, v1 object, v2 object, garbage) to a valid v2 state. */
  function migrate(raw, now) {
    var nowStr = nowISO(now), warnings = [], migratedFrom = null, state = emptyState();
    function adopt(arr) {
      var seen = {};
      return (Array.isArray(arr) ? arr : []).map(function (t) { return sanitizeTask(t, nowStr); })
        .filter(function (t) { if (!t) return false; if (seen[t.id]) t.id = genId(); seen[t.id] = true; return true; });
    }
    if (Array.isArray(raw)) {                       // original kanban_v3 format
      state.tasks = adopt(raw);
      migratedFrom = 'kanban_v3';
      if (state.tasks.length !== raw.length) warnings.push((raw.length - state.tasks.length) + ' unreadable card(s) were skipped.');
    } else if (raw && typeof raw === 'object') {
      var v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
      if (v > SCHEMA_VERSION) warnings.push('This data was created by a newer version of the app; some fields may be ignored.');
      if (v < SCHEMA_VERSION) migratedFrom = 'v' + v;
      state.tasks = adopt(raw.tasks);
      state.meetings = (Array.isArray(raw.meetings) ? raw.meetings : []).map(function (m) { return sanitizeMeeting(m, nowStr); }).filter(Boolean);
      state.activity = (Array.isArray(raw.activity) ? raw.activity : []).map(sanitizeActivity).filter(Boolean).slice(0, MAX_ACTIVITY);
      // repair dangling links: approved items must point at an existing task, otherwise they go back to draft
      var ids = {};
      state.tasks.forEach(function (t) { ids[t.id] = true; });
      state.meetings.forEach(function (m) {
        [m.analysis].concat(m.analysisHistory).forEach(function (a) {
          if (!a) return;
          a.actionItems.forEach(function (i) { if (i.status === 'approved' && (!i.taskId || !ids[i.taskId])) { i.status = 'draft'; i.taskId = null; } });
        });
      });
    } else if (raw != null) {
      warnings.push('Stored data was unreadable and was ignored.');
    }
    return { state: state, migratedFrom: migratedFrom, warnings: warnings };
  }

  /* ------------------------------------------------------------------ activity log */
  function logActivity(state, entry, now) {
    var e = { id: genId(), at: nowISO(now), type: entry.type, taskId: entry.taskId, taskTitle: entry.taskTitle, from: entry.from || null, to: entry.to || null };
    return Object.assign({}, state, { activity: [e].concat(state.activity).slice(0, MAX_ACTIVITY) });
  }
  function columnLabel(id) { var c = COLUMNS.filter(function (x) { return x.id === id; })[0]; return c ? c.label : id; }
  function describeActivity(a) {
    switch (a.type) {
      case 'created': return 'Task created: ' + a.taskTitle;
      case 'approved': return 'Task created from meeting: ' + a.taskTitle;
      case 'moved': return a.taskTitle + ' moved from ' + columnLabel(a.from) + ' to ' + columnLabel(a.to);
      case 'completed': return a.taskTitle + ' completed';
      case 'reopened': return a.taskTitle + ' reopened (' + columnLabel(a.to) + ')';
      case 'edited': return 'Task edited: ' + a.taskTitle;
      case 'deleted': return 'Task deleted: ' + a.taskTitle;
      default: return a.taskTitle;
    }
  }

  /* ------------------------------------------------------------------ tasks */
  function cleanTaskFields(f) {
    var out = {};
    if ('title' in f) out.title = str(f.title, 200);
    if ('description' in f) out.description = str(f.description, 2000);
    if ('priority' in f) out.priority = pickPriority(f.priority);
    if ('assignee' in f) out.assignee = str(f.assignee, 120) === UNASSIGNED ? '' : str(f.assignee, 120);
    if ('project' in f) out.project = str(f.project, 200);
    if ('dueDate' in f) out.dueDate = isValidISODate(f.dueDate) ? f.dueDate : null;
    if ('column' in f && COLUMN_IDS.indexOf(f.column) >= 0) out.column = f.column;
    return out;
  }

  function addTask(state, fields, now, extra) {
    var ts = nowISO(now), f = cleanTaskFields(fields || {});
    if (!f.title) throw new Error('A task needs a title.');
    var task = sanitizeTask(Object.assign({ column: 'open', priority: 'Medium' }, f, extra || {}, {
      id: genId(), createdAt: ts, updatedAt: ts, completedAt: null
    }), ts);
    if (task.column === 'completed') task.completedAt = ts;
    var next = Object.assign({}, state, { tasks: state.tasks.concat([task]) });
    next = logActivity(next, { type: (extra && extra.sourceMeetingId) ? 'approved' : 'created', taskId: task.id, taskTitle: task.title }, now);
    return { state: next, task: task };
  }

  function updateTask(state, id, patch, now) {
    var ts = nowISO(now), f = cleanTaskFields(patch || {}), found = null, activity = null;
    if ('title' in f && !f.title) throw new Error('A task needs a title.');
    var tasks = state.tasks.map(function (t) {
      if (t.id !== id) return t;
      found = t;
      var n = Object.assign({}, t, f, { updatedAt: ts });
      if (f.column && f.column !== t.column) {
        if (f.column === 'completed') { n.completedAt = ts; activity = { type: 'completed', from: t.column, to: f.column }; }
        else if (t.column === 'completed') { n.completedAt = null; activity = { type: 'reopened', from: t.column, to: f.column }; }
        else activity = { type: 'moved', from: t.column, to: f.column };
      } else if (Object.keys(f).some(function (k) { return k !== 'column' && f[k] !== t[k]; })) {
        activity = { type: 'edited' };
      }
      return n;
    });
    if (!found) return state;
    var next = Object.assign({}, state, { tasks: tasks });
    if (activity) next = logActivity(next, Object.assign({ taskId: id, taskTitle: (f.title || found.title) }, activity), now);
    return next;
  }

  function moveTask(state, id, column, now) {
    if (COLUMN_IDS.indexOf(column) < 0) return state;
    return updateTask(state, id, { column: column }, now);
  }

  function deleteTask(state, id, now) {
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return state;
    var meetings = state.meetings.map(function (m) { // approved items linked to this task go back to draft
      var touch = function (a) {
        if (!a) return a;
        return Object.assign({}, a, { actionItems: a.actionItems.map(function (i) { return i.taskId === id ? Object.assign({}, i, { status: 'draft', taskId: null }) : i; }) });
      };
      return Object.assign({}, m, { analysis: touch(m.analysis), analysisHistory: m.analysisHistory.map(touch) });
    });
    var next = Object.assign({}, state, { tasks: state.tasks.filter(function (x) { return x.id !== id; }), meetings: meetings });
    return logActivity(next, { type: 'deleted', taskId: id, taskTitle: t.title }, now);
  }

  /* ------------------------------------------------------------------ due dates */
  /** 'overdue' | 'today' | 'soon' | 'later' | null.  Completed tasks and tasks without a date are never overdue.
   *  Hold tasks ARE counted: the deadline was still missed, and the UI labels them "On hold". */
  function dueState(task, now) {
    if (!task || !task.dueDate || task.column === 'completed' || !isValidISODate(task.dueDate)) return null;
    var d = dayDiff(task.dueDate, toISODate(now || new Date()));
    if (d < 0) return 'overdue';
    if (d === 0) return 'today';
    if (d <= DUE_SOON_DAYS) return 'soon';
    return 'later';
  }
  function isOverdue(task, now) { return dueState(task, now) === 'overdue'; }
  function dueLabel(task, now) {
    if (!task || !task.dueDate) return '';
    var st = dueState(task, now), d = dayDiff(task.dueDate, toISODate(now || new Date()));
    if (st === 'overdue') return 'Overdue by ' + (-d) + ' day' + (d === -1 ? '' : 's');
    if (st === 'today') return 'Due today';
    if (st === 'soon') return d === 1 ? 'Due tomorrow' : 'Due in ' + d + ' days';
    return 'Due ' + formatDate(task.dueDate);
  }

  /* ------------------------------------------------------------------ meetings & analysis */
  function validateTranscript(text, max) {
    var limit = max || MAX_TRANSCRIPT_CHARS;
    var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    if (!t) return { ok: false, error: 'Paste or upload a transcript first.' };
    if (t.length < MIN_TRANSCRIPT_CHARS) return { ok: false, error: 'The transcript is too short to analyze (minimum ' + MIN_TRANSCRIPT_CHARS + ' characters).' };
    if (t.length > limit) return { ok: false, error: 'The transcript has ' + t.length.toLocaleString('en-US') + ' characters; the limit is ' + limit.toLocaleString('en-US') + '. Split it into parts (for example one per agenda item) and analyze each separately.' };
    return { ok: true, text: t };
  }
  function validateUpload(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    if (!/\.txt$/i.test(file.name || '')) return { ok: false, error: 'Unsupported file type. Upload a plain-text .txt transcript (or paste the text).' };
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That file is larger than 1 MB. Upload a smaller transcript or split it.' };
    if (file.size === 0) return { ok: false, error: 'That file is empty.' };
    return { ok: true };
  }
  function looksLikeText(content) {
    if (typeof content !== 'string') return false;
    if (content.indexOf('\u0000') >= 0) return false;
    var bad = (content.match(/\uFFFD/g) || []).length;
    return bad / Math.max(1, content.length) < 0.02;
  }

  function parseList(s) {
    var seen = {};
    return String(s || '').split(/[,;\n]/).map(function (x) { return x.trim().slice(0, 100); }).filter(function (x) { if (!x || seen[x.toLowerCase()]) return false; seen[x.toLowerCase()] = true; return true; });
  }
  function speakersOf(transcript) {
    var out = [], re = /^\s*(?:\[[^\]]*\]\s*)?([A-Z][A-Za-z.'\-]*(?: [A-Z][A-Za-z.'\-]*){0,2})\s*:\s*\S/gm, m;
    while ((m = re.exec(transcript || ''))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }

  function addMeeting(state, fields, now) {
    var ts = nowISO(now);
    var m = sanitizeMeeting({
      id: genId(), title: fields.title, startsAt: fields.startsAt, participants: fields.participants || [],
      project: fields.project, transcript: fields.transcript || '', isDemo: !!fields.isDemo, createdAt: ts, updatedAt: ts
    }, ts);
    return { state: Object.assign({}, state, { meetings: state.meetings.concat([m]) }), meeting: m };
  }
  function mapMeeting(state, id, fn) {
    return Object.assign({}, state, { meetings: state.meetings.map(function (m) { return m.id === id ? fn(m) : m; }) });
  }
  function updateMeeting(state, id, patch, now) {
    var ts = nowISO(now);
    return mapMeeting(state, id, function (m) {
      var n = Object.assign({}, m, { updatedAt: ts });
      if ('title' in patch) n.title = str(patch.title, 200) || 'Untitled meeting';
      if ('startsAt' in patch) n.startsAt = typeof patch.startsAt === 'string' && isValidISODate(patch.startsAt.slice(0, 10)) ? patch.startsAt.slice(0, 16) : '';
      if ('participants' in patch) n.participants = strList(patch.participants, 50);
      if ('project' in patch) n.project = str(patch.project, 200);
      if ('transcript' in patch) n.transcript = typeof patch.transcript === 'string' ? patch.transcript.slice(0, MAX_TRANSCRIPT_CHARS * 2) : m.transcript;
      return n;
    });
  }
  function deleteMeeting(state, id) {
    return Object.assign({}, state, { meetings: state.meetings.filter(function (m) { return m.id !== id; }) });
  }
  function findDuplicateMeeting(state, transcript, exceptId) {
    var h = hashText(transcript);
    return state.meetings.filter(function (m) { return m.id !== exceptId && m.transcript && hashText(m.transcript) === h; })[0] || null;
  }

  /** Convert the API response into the stored analysis shape. Throws on structurally invalid responses. */
  function analysisFromApi(res, transcript, now, approvedTitles) {
    if (!res || typeof res !== 'object' || !res.analysis || typeof res.analysis !== 'object') throw new Error('The server returned an unexpected response.');
    var a = res.analysis, ts = nowISO(now), known = {};
    (approvedTitles || []).forEach(function (t) { known[normTitle(t)] = true; });
    if (!Array.isArray(a.action_items) || !Array.isArray(a.decisions)) throw new Error('The analysis was missing decisions or action items.');
    var items = a.action_items.map(function (i) {
      var reasons = Array.isArray(i.review_reasons) ? i.review_reasons.slice() : [];
      if (known[normTitle(i.title)]) reasons.push('Possible duplicate of a task you already approved from an earlier analysis.');
      return {
        id: genId(), title: i.title, description: i.description, owner: i.owner || UNASSIGNED, dueDate: i.due_date, dueText: i.due_text,
        priority: i.priority, topic: i.topic, evidence: i.evidence, evidenceVerified: !!i.evidence_verified,
        confidence: typeof i.confidence === 'number' ? i.confidence : null,
        needsReview: !!i.needs_review || reasons.length > 0, needsClarification: !!i.needs_clarification,
        reviewReasons: reasons, reviewed: false, status: 'draft', taskId: null, updatedAt: ts
      };
    }).filter(function (i) { return str(i.title); });
    return sanitizeAnalysis({
      id: genId(), mode: res.mode, provider: res.provider, model: res.model, label: res.label, generatedAt: ts,
      transcriptHash: hashText(transcript), summary: a.meeting_summary, mainTopics: a.main_topics, outcomes: a.outcomes,
      unresolved: a.unresolved,
      decisions: a.decisions.map(function (d) { return { description: d.description, evidence: d.evidence, evidenceVerified: d.evidence_verified, topic: d.topic, status: d.status }; }),
      actionItems: items, discussionPoints: a.discussion_points, risks: a.risks, blockers: a.blockers, dependencies: a.dependencies,
      openQuestions: a.open_questions, missingInformation: a.missing_information, warnings: res.warnings
    }, ts);
  }

  function approvedTitles(meeting) {
    var out = [];
    [meeting.analysis].concat(meeting.analysisHistory || []).forEach(function (a) {
      if (a) a.actionItems.forEach(function (i) { if (i.status === 'approved') out.push(i.title); });
    });
    return out;
  }

  /** Store a new analysis; any previous analysis is kept in analysisHistory (never silently overwritten). */
  function recordAnalysis(state, meetingId, apiResult, now) {
    var m = state.meetings.filter(function (x) { return x.id === meetingId; })[0];
    if (!m) throw new Error('Meeting not found.');
    var analysis = analysisFromApi(apiResult, m.transcript, now, approvedTitles(m));
    return mapMeeting(state, meetingId, function (mm) {
      return Object.assign({}, mm, {
        analysis: analysis, status: 'analyzed', lastError: null, updatedAt: nowISO(now),
        analysisHistory: (mm.analysis ? [mm.analysis].concat(mm.analysisHistory) : mm.analysisHistory).slice(0, 20)
      });
    });
  }
  function recordAnalysisFailure(state, meetingId, message, now) {
    return mapMeeting(state, meetingId, function (m) {
      return Object.assign({}, m, { status: m.analysis ? 'analyzed' : 'failed', lastError: str(message, 500), updatedAt: nowISO(now) });
    });
  }

  /* ------------------------------------------------------------------ action-item review */
  function mapItem(state, meetingId, itemId, fn) {
    return mapMeeting(state, meetingId, function (m) {
      if (!m.analysis) return m;
      return Object.assign({}, m, { analysis: Object.assign({}, m.analysis, {
        actionItems: m.analysis.actionItems.map(function (i) { return i.id === itemId ? fn(i) : i; }) }) });
    });
  }
  function getItem(state, meetingId, itemId) {
    var m = state.meetings.filter(function (x) { return x.id === meetingId; })[0];
    return m && m.analysis ? m.analysis.actionItems.filter(function (i) { return i.id === itemId; })[0] || null : null;
  }

  /** Edit a draft item. Approved items are locked (edit the task on the Kanban board instead). */
  function updateActionItem(state, meetingId, itemId, patch, now) {
    var it = getItem(state, meetingId, itemId);
    if (!it || it.status === 'approved') return state;
    return mapItem(state, meetingId, itemId, function (i) {
      var n = Object.assign({}, i, { updatedAt: nowISO(now), reviewed: true });
      if ('title' in patch) n.title = str(patch.title, 200);
      if ('description' in patch) n.description = str(patch.description, 1500);
      if ('owner' in patch) n.owner = str(patch.owner, 120) || UNASSIGNED;
      if ('priority' in patch) n.priority = pickPriority(patch.priority);
      if ('topic' in patch) n.topic = str(patch.topic, 200) || null;
      if ('dueDate' in patch) { n.dueDate = isValidISODate(patch.dueDate) ? patch.dueDate : null; if (n.dueDate) n.needsClarification = false; }
      return n;
    });
  }
  function markReviewed(state, meetingId, itemId, now) {
    var it = getItem(state, meetingId, itemId);
    if (!it || it.status === 'approved') return state;
    return mapItem(state, meetingId, itemId, function (i) { return Object.assign({}, i, { reviewed: true, updatedAt: nowISO(now) }); });
  }
  function rejectActionItem(state, meetingId, itemId, now) {
    var it = getItem(state, meetingId, itemId);
    if (!it || it.status !== 'draft') return state;
    return mapItem(state, meetingId, itemId, function (i) { return Object.assign({}, i, { status: 'rejected', updatedAt: nowISO(now) }); });
  }
  function restoreActionItem(state, meetingId, itemId, now) {
    var it = getItem(state, meetingId, itemId);
    if (!it || it.status !== 'rejected') return state;
    return mapItem(state, meetingId, itemId, function (i) { return Object.assign({}, i, { status: 'draft', updatedAt: nowISO(now) }); });
  }
  function deleteActionItem(state, meetingId, itemId) {
    var it = getItem(state, meetingId, itemId);
    if (!it || it.status === 'approved') return state;
    return mapMeeting(state, meetingId, function (m) {
      return Object.assign({}, m, { analysis: Object.assign({}, m.analysis, { actionItems: m.analysis.actionItems.filter(function (i) { return i.id !== itemId; }) }) });
    });
  }
  function addManualActionItem(state, meetingId, fields, now) {
    var ts = nowISO(now), title = str(fields && fields.title, 200);
    if (!title) throw new Error('An action item needs a title.');
    var item = sanitizeItem({ id: genId(), title: title, description: fields.description, owner: fields.owner, dueDate: fields.dueDate,
      priority: fields.priority, evidence: '', needsReview: false, reviewed: true, manual: true, status: 'draft', updatedAt: ts }, ts);
    var next = mapMeeting(state, meetingId, function (m) {
      var base = m.analysis || sanitizeAnalysis({ id: genId(), mode: 'demo', label: 'Manual entry', generatedAt: ts, summary: '' }, ts);
      return Object.assign({}, m, { analysis: Object.assign({}, base, { actionItems: base.actionItems.concat([item]) }), status: 'analyzed', updatedAt: ts });
    });
    return { state: next, item: item };
  }

  /** Items still carrying unresolved review flags (used to warn before bulk approval). */
  function unresolvedFlagCount(meeting, ids) {
    if (!meeting || !meeting.analysis) return 0;
    return meeting.analysis.actionItems.filter(function (i) {
      return i.status === 'draft' && (!ids || ids.indexOf(i.id) >= 0) && i.needsReview && !i.reviewed;
    }).length;
  }

  /**
   * Approve draft items -> create Kanban tasks (status Open). Idempotent: an item that is already approved,
   * rejected, empty or already linked to a task (same sourceActionId) is skipped, so double clicks cannot duplicate.
   * ids: array of item ids, or the string 'all' for every remaining draft item.
   */
  function approveActionItems(state, meetingId, ids, now) {
    var m = state.meetings.filter(function (x) { return x.id === meetingId; })[0];
    var result = { state: state, created: [], skipped: 0 };
    if (!m || !m.analysis) return result;
    var wanted = ids === 'all' ? m.analysis.actionItems.map(function (i) { return i.id; }) : (ids || []);
    var current = state;
    wanted.forEach(function (id) {
      var meeting = current.meetings.filter(function (x) { return x.id === meetingId; })[0];
      var item = meeting.analysis.actionItems.filter(function (i) { return i.id === id; })[0];
      if (!item || item.status !== 'draft' || !str(item.title)) { if (item && item.status !== 'draft') result.skipped++; return; }
      if (current.tasks.some(function (t) { return t.sourceMeetingId === meetingId && t.sourceActionId === id; })) { result.skipped++; return; }
      var added = addTask(current, {
        title: item.title, description: item.description, priority: item.priority,
        assignee: item.owner === UNASSIGNED ? '' : item.owner, dueDate: item.dueDate, project: item.topic || meeting.project || ''
      }, now, { sourceMeetingId: meetingId, sourceActionId: id, sourceEvidence: item.evidence || null, column: 'open' });
      current = mapItem(added.state, meetingId, id, function (i) { return Object.assign({}, i, { status: 'approved', taskId: added.task.id, reviewed: true, updatedAt: nowISO(now) }); });
      result.created.push(added.task.id);
    });
    result.state = current;
    return result;
  }

  /* ------------------------------------------------------------------ filters & metrics */
  function matchesOwner(task, owner) { return !owner || ownerOf(task) === owner; }
  function filterTasks(tasks, f, now, search) {
    f = f || {};
    var q = String(search || '').trim().toLowerCase();
    return tasks.filter(function (t) {
      if (f.meetingId && t.sourceMeetingId !== f.meetingId) return false;
      if (f.project && (t.project || '').toLowerCase() !== f.project.toLowerCase()) return false;
      if (!matchesOwner(t, f.owner)) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.status && t.column !== f.status) return false;
      if (f.dueFrom || f.dueTo) {
        if (!t.dueDate) return false;
        if (f.dueFrom && t.dueDate < f.dueFrom) return false;
        if (f.dueTo && t.dueDate > f.dueTo) return false;
      }
      if (q && (t.title + ' ' + t.description + ' ' + (t.assignee || '') + ' ' + (t.project || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function computeMetrics(state, f, now) {
    f = f || {};
    var tasks = filterTasks(state.tasks, f, now);
    var meetings = state.meetings.filter(function (m) {
      if (f.meetingId && m.id !== f.meetingId) return false;
      if (f.project && (m.project || '').toLowerCase() !== f.project.toLowerCase()) return false;
      return true;
    });
    var analyzed = meetings.filter(function (m) { return m.analysis; });
    var items = [];
    analyzed.forEach(function (m) { m.analysis.actionItems.forEach(function (i) { items.push(i); }); });

    var byStatus = {}; COLUMN_IDS.forEach(function (c) { byStatus[c] = 0; });
    var byPriority = { High: 0, Medium: 0, Low: 0 };
    var owners = {}, overdue = 0, dueToday = 0, unassigned = 0;
    tasks.forEach(function (t) {
      byStatus[t.column]++; byPriority[t.priority]++;
      var o = ownerOf(t), row = owners[o] || (owners[o] = { owner: o, total: 0, active: 0, completed: 0, overdue: 0 });
      row.total++; if (t.column === 'completed') row.completed++; else row.active++;
      var ds = dueState(t, now);
      if (ds === 'overdue') { overdue++; row.overdue++; }
      if (ds === 'today') dueToday++;
      if (!t.assignee && t.column !== 'completed') unassigned++;
    });
    var ownerRows = Object.keys(owners).map(function (k) { return owners[k]; })
      .sort(function (a, b) { return b.total - a.total || a.owner.localeCompare(b.owner); });
    var ids = {}; tasks.forEach(function (t) { ids[t.id] = true; });
    var recent = state.activity.filter(function (a) { return !(f.meetingId || f.project || f.owner || f.priority || f.status || f.dueFrom || f.dueTo) || ids[a.taskId]; })
      .slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 8);

    return {
      meetings: {
        analyzed: analyzed.length,
        decisions: analyzed.reduce(function (n, m) { return n + m.analysis.decisions.length; }, 0),
        actionItemsExtracted: items.filter(function (i) { return !i.manual; }).length,
        actionItemsApproved: items.filter(function (i) { return i.status === 'approved'; }).length
      },
      tasks: {
        total: tasks.length, open: byStatus.open, inprogress: byStatus.inprogress, hold: byStatus.hold, completed: byStatus.completed,
        overdue: overdue, dueToday: dueToday, unassigned: unassigned
      },
      completionRate: tasks.length ? Math.round(byStatus.completed / tasks.length * 100) : 0,
      byStatus: byStatus, byPriority: byPriority, byOwner: ownerRows,
      overdueByOwner: ownerRows.filter(function (r) { return r.overdue > 0; }).sort(function (a, b) { return b.overdue - a.overdue; }),
      recentActivity: recent,
      overdueTasks: tasks.filter(function (t) { return isOverdue(t, now); }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; })
    };
  }

  function knownOwners(state, extra) {
    var seen = {}, out = [];
    function add(n) { n = str(n, 120); if (n && n !== UNASSIGNED && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; out.push(n); } }
    (extra || []).forEach(add);
    state.tasks.forEach(function (t) { add(t.assignee); });
    state.meetings.forEach(function (m) { m.participants.forEach(add); });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function knownProjects(state) {
    var seen = {}, out = [];
    state.tasks.forEach(function (t) { if (t.project && !seen[t.project.toLowerCase()]) { seen[t.project.toLowerCase()] = true; out.push(t.project); } });
    state.meetings.forEach(function (m) { if (m.project && !seen[m.project.toLowerCase()]) { seen[m.project.toLowerCase()] = true; out.push(m.project); } });
    return out.sort();
  }

  /* ------------------------------------------------------------------ traceability */
  function findMeeting(state, id) { return state.meetings.filter(function (m) { return m.id === id; })[0] || null; }
  function tasksForMeeting(state, meetingId) { return state.tasks.filter(function (t) { return t.sourceMeetingId === meetingId; }); }
  /** Split transcript text into [{text, mark}] so an evidence excerpt can be highlighted safely (caller escapes). */
  function highlightParts(transcript, excerpt) {
    var t = String(transcript || ''), e = String(excerpt || '').trim().replace(/^["'\u201c]|["'\u201d]$/g, '');
    if (!t || e.length < 4) return null;
    var lower = t.toLowerCase(), cands = [e].concat(e.split(/\.\.\.|\u2026/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 12; }));
    for (var i = 0; i < cands.length; i++) {
      var idx = lower.indexOf(cands[i].toLowerCase());
      if (idx >= 0) return [{ text: t.slice(0, idx), mark: false }, { text: t.slice(idx, idx + cands[i].length), mark: true }, { text: t.slice(idx + cands[i].length), mark: false }];
    }
    return null;
  }

  /* ------------------------------------------------------------------ export / import */
  function exportData(state, now) {
    return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(now), data: { tasks: state.tasks, meetings: state.meetings, activity: state.activity } };
  }
  function parseImport(text, now) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, errors: ['The file is not valid JSON.'] }; }
    if (Array.isArray(parsed)) { // also accept a raw legacy kanban array
      var r0 = migrate(parsed, now);
      return { ok: true, state: r0.state, warnings: r0.warnings, counts: { tasks: r0.state.tasks.length, meetings: 0 } };
    }
    if (!parsed || typeof parsed !== 'object' || parsed.app !== APP_ID || !parsed.data || typeof parsed.data !== 'object')
      return { ok: false, errors: ['This does not look like a backup exported from this app.'] };
    if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion > SCHEMA_VERSION)
      return { ok: false, errors: ['This backup was created by a newer version of the app (schema ' + parsed.schemaVersion + ').'] };
    if (!Array.isArray(parsed.data.tasks) || !Array.isArray(parsed.data.meetings))
      return { ok: false, errors: ['The backup is missing its task or meeting lists.'] };
    var r = migrate({ schemaVersion: parsed.schemaVersion, tasks: parsed.data.tasks, meetings: parsed.data.meetings, activity: parsed.data.activity }, now);
    var skipped = parsed.data.tasks.length - r.state.tasks.length + parsed.data.meetings.length - r.state.meetings.length;
    return { ok: true, state: r.state, warnings: r.warnings.concat(skipped > 0 ? [skipped + ' unreadable record(s) were skipped.'] : []),
      counts: { tasks: r.state.tasks.length, meetings: r.state.meetings.length } };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, STORAGE_KEY: STORAGE_KEY, LEGACY_KEY: LEGACY_KEY, APP_ID: APP_ID, COLUMNS: COLUMNS, PRIORITIES: PRIORITIES,
    UNASSIGNED: UNASSIGNED, DUE_SOON_DAYS: DUE_SOON_DAYS, MAX_TRANSCRIPT_CHARS: MAX_TRANSCRIPT_CHARS, MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    genId: genId, esc: esc, toISODate: toISODate, isValidISODate: isValidISODate, dayDiff: dayDiff, addDays: addDays,
    formatDate: formatDate, formatDateTime: formatDateTime, formatTimestamp: formatTimestamp, hashText: hashText, ownerOf: ownerOf, clone: clone,
    emptyState: emptyState, migrate: migrate, sanitizeTask: sanitizeTask,
    addTask: addTask, updateTask: updateTask, moveTask: moveTask, deleteTask: deleteTask,
    dueState: dueState, isOverdue: isOverdue, dueLabel: dueLabel,
    validateTranscript: validateTranscript, validateUpload: validateUpload, looksLikeText: looksLikeText, parseList: parseList, speakersOf: speakersOf,
    addMeeting: addMeeting, updateMeeting: updateMeeting, deleteMeeting: deleteMeeting, findDuplicateMeeting: findDuplicateMeeting,
    analysisFromApi: analysisFromApi, recordAnalysis: recordAnalysis, recordAnalysisFailure: recordAnalysisFailure,
    updateActionItem: updateActionItem, markReviewed: markReviewed, rejectActionItem: rejectActionItem, restoreActionItem: restoreActionItem,
    deleteActionItem: deleteActionItem, addManualActionItem: addManualActionItem, approveActionItems: approveActionItems,
    unresolvedFlagCount: unresolvedFlagCount, getItem: getItem,
    filterTasks: filterTasks, computeMetrics: computeMetrics, knownOwners: knownOwners, knownProjects: knownProjects,
    findMeeting: findMeeting, tasksForMeeting: tasksForMeeting, highlightParts: highlightParts, describeActivity: describeActivity,
    columnLabel: columnLabel, exportData: exportData, parseImport: parseImport
  };
});

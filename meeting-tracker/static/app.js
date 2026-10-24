/* app.js — UI layer. All business rules live in core.js; this file renders state and wires events. */
(function () {
  'use strict';
  var C = window.Core, Demo = window.DemoData;
  var esc = C.esc;
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var AVATAR_COLORS = ['#4a86e8', '#e87c4a', '#2f9e8a', '#a04ae8', '#e84a7e', '#3e9b3e', '#b8921f'];
  var STATUS_COLORS = { open: 'var(--s-open)', inprogress: 'var(--s-inprogress)', hold: 'var(--s-hold)', completed: 'var(--s-completed)' };
  var PRIO_COLORS = { High: '#E53935', Medium: '#FFB300', Low: '#43A047' };
  var ANALYZE_TIMEOUT_MS = 70000;

  var app = {
    state: C.emptyState(), storageOk: true, health: null,
    route: { name: 'dashboard' }, routeChanged: false,
    dash: {}, kFilters: {}, kSearch: '', mSearch: '',
    draft: null, analyzing: {}, errors: {}, selected: {}, approving: false,
    dragId: null, addingTo: null, openMenu: null, showEvidence: null, formError: null, formMode: 'auto'
  };
  window.__app = app; // handy for debugging / tests

  /* ================================================================== persistence */
  function persist() {
    try { localStorage.setItem(C.STORAGE_KEY, JSON.stringify(app.state)); setStorageOk(true); return true; }
    catch (e) { setStorageOk(false); return false; }
  }
  function setStorageOk(ok) {
    app.storageOk = ok;
    var b = $('#banner');
    if (!ok) { b.textContent = 'Your changes cannot be saved in this browser (storage is full or blocked). Export a backup from “Data & backup” so you do not lose work.'; b.hidden = false; }
    else if (b.dataset.kind === 'storage') { b.hidden = true; }
    b.dataset.kind = ok ? '' : 'storage';
  }
  function loadState() {
    var now = new Date(), raw = null, notes = [], fromLegacy = false;
    try {
      var s = localStorage.getItem(C.STORAGE_KEY);
      if (s) raw = JSON.parse(s);
    } catch (e) {
      try { localStorage.setItem('meeting_tracker_v2_corrupt_backup', localStorage.getItem(C.STORAGE_KEY) || ''); } catch (e2) { /* ignore */ }
      notes.push('Saved data was unreadable. A raw copy was kept under the key meeting_tracker_v2_corrupt_backup.');
    }
    if (raw == null) {
      var legacyText = null;
      try { legacyText = localStorage.getItem(C.LEGACY_KEY); } catch (e) { /* storage blocked */ }
      if (legacyText) {
        try { raw = JSON.parse(legacyText); fromLegacy = true; }
        catch (e) { notes.push('Your previous Kanban data (kanban_v3) could not be parsed and was left untouched.'); }
        try { localStorage.setItem('meeting_tracker_legacy_backup', legacyText); } catch (e) { /* ignore */ }
      }
    }
    var res = C.migrate(raw, now);
    app.state = res.state;
    if (fromLegacy && res.state.tasks.length) notes.push('Upgraded ' + res.state.tasks.length + ' existing Kanban card(s). Your original data (kanban_v3) is untouched and a backup copy was saved.');
    res.warnings.forEach(function (w) { notes.push(w); });
    if (res.migratedFrom || fromLegacy) persist();
    if (notes.length) setTimeout(function () { notes.forEach(function (n) { toast(n, 'info', 9000); }); }, 50);
  }
  function commit(next, opts) {
    app.state = next; persist(); updateNavBadge();
    if (!opts || !opts.noRender) render();
  }

  /* ================================================================== tiny UI helpers */
  function toast(msg, kind, ms) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    if (kind === 'error') t.setAttribute('role', 'alert');
    $('#toasts').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || (kind === 'error' ? 8000 : 4500));
  }
  function opt(value, label, selected, disabled) {
    return '<option value="' + esc(value) + '"' + (String(selected) === String(value) ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + esc(label) + '</option>';
  }
  function initials(n) { return n ? n.trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase() : '?'; }
  function avatarColor(n) { var h = 0; for (var i = 0; i < (n || '').length; i++) h = (h * 31 + n.charCodeAt(i)) % AVATAR_COLORS.length; return AVATAR_COLORS[h]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function today() { return C.toISODate(new Date()); }
  function meetingOf(id) { return C.findMeeting(app.state, id); }

  var modals = [];
  function openModal(o) {
    var root = $('#modal-root'), last = document.activeElement;
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-' + modals.length + '" style="' + (o.width ? 'width:' + o.width : '') + '">' +
      '<h2 id="modal-title-' + modals.length + '">' + esc(o.title) + '</h2>' + o.html + '</div>';
    root.appendChild(back);
    var handle = { el: back, closed: false, close: function (result) {
      if (handle.closed) return; handle.closed = true;
      modals = modals.filter(function (m) { return m !== handle; });
      if (back.parentNode) back.parentNode.removeChild(back);
      if (last && last.focus && document.contains(last)) { try { last.focus(); } catch (e) { /* ignore */ } }
      if (o.onClose) o.onClose(result);
    } };
    modals.push(handle);
    back.addEventListener('mousedown', function (e) { if (e.target === back) handle.close(false); });
    back.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); handle.close(false); return; }
      if (e.key === 'Tab') {
        var f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', back).filter(function (x) { return !x.disabled && x.offsetParent !== null || x === document.activeElement; });
        if (!f.length) return;
        var first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    });
    if (o.onMount) o.onMount(handle);
    var auto = $('[data-autofocus]', back) || $('input, select, textarea, button', back.querySelector('.modal'));
    if (auto) auto.focus();
    return handle;
  }
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var done = false;
      var h = openModal({
        title: o.title, width: '440px',
        html: '<p>' + esc(o.message) + '</p><div class="modal-actions"><button class="btn" type="button" data-x="cancel">' + esc(o.cancelLabel || 'Cancel') +
          '</button><button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-x="ok" data-autofocus>' + esc(o.confirmLabel || 'Confirm') + '</button></div>',
        onMount: function (hh) {
          hh.el.addEventListener('click', function (e) {
            var b = e.target.closest('[data-x]'); if (!b) return;
            done = true; hh.close(b.dataset.x === 'ok'); resolve(b.dataset.x === 'ok');
          });
        },
        onClose: function (r) { if (!done) resolve(false); }
      });
      return h;
    });
  }

  function updateNavBadge() {
    var n = C.computeMetrics(app.state, {}, new Date()).tasks.overdue, b = $('#nav-overdue');
    b.hidden = n === 0; b.textContent = n;
    b.setAttribute('aria-label', plural(n, 'overdue task'));
  }

  /* ================================================================== routing */
  function parseHash() {
    var h = (location.hash || '#/dashboard').replace(/^#\/?/, ''), q = {}, parts = h.split('?');
    if (parts[1]) parts[1].split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    var seg = parts[0].split('/').filter(Boolean);
    if (seg[0] === 'meetings') return seg[1] ? { name: 'meeting', id: seg[1], q: q } : { name: 'meetings', q: q };
    if (seg[0] === 'kanban') return { name: 'kanban', q: q, task: q.task || null };
    return { name: 'dashboard', q: q };
  }
  function onHashChange() { app.route = parseHash(); app.routeChanged = true; app.formError = null; app.openMenu = null; render(); }
  function go(hash) { if (location.hash === hash) { onHashChange(); } else { location.hash = hash; } }

  /* ================================================================== render root */
  function render() {
    var main = $('#main'), r = app.route, html = '', title = 'Meeting Action Tracker';
    var active = document.activeElement, activeId = active && active.id, sel = null;
    if (activeId && active.setSelectionRange && !app.routeChanged) { try { sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; } }
    switch (r.name) {
      case 'meetings': html = viewMeetings(); title = 'Meetings'; break;
      case 'meeting': html = viewMeeting(); title = 'Meeting'; break;
      case 'kanban': html = viewKanban(); title = 'Kanban board'; break;
      default: html = viewDashboard(); title = 'Dashboard';
    }
    main.innerHTML = html;
    document.title = title + ' · Meeting Action Tracker';
    $$('[data-nav]').forEach(function (a) {
      var on = a.dataset.nav === (r.name === 'meeting' ? 'meetings' : r.name);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    updateNavBadge();
    if (app.routeChanged) { main.focus({ preventScroll: false }); window.scrollTo(0, 0); app.routeChanged = false; }
    else if (activeId) {
      var again = document.getElementById(activeId);
      if (again && main.contains(again)) { again.focus(); if (sel && again.setSelectionRange) { try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
    }
    afterRender();
  }
  function afterRender() {
    var r = app.route;
    if (r.name === 'kanban' && r.task && !modals.length) {
      var t = app.state.tasks.filter(function (x) { return x.id === r.task; })[0];
      if (t) openTaskModal(t.id);
    }
    if (r.name === 'meeting' && app.showEvidence && app.showEvidence.meetingId === r.id) {
      var mk = $('mark'); if (mk && mk.scrollIntoView) { try { mk.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }
    }
    if (r.name === 'meeting' && r.q && r.q.item) {
      var it = document.getElementById('item-' + r.q.item);
      if (it) { it.classList.add('highlight'); if (it.scrollIntoView) { try { it.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } } }
    }
  }

  /* ================================================================== dashboard */
  function viewDashboard() {
    var st = app.state, f = app.dash, m = C.computeMetrics(st, f, new Date());
    if (!st.meetings.length && !st.tasks.length) {
      return '<div class="page-head"><div><h1>Dashboard</h1><p>Meeting outcomes, ownership and progress at a glance.</p></div></div>' +
        '<div class="card empty"><h2>Nothing to show yet</h2><p>Turn a meeting transcript into tracked work: analyze it, review the suggested actions, and approve them onto the Kanban board.</p>' +
        '<div class="actions"><button class="btn btn-primary" type="button" data-action="load-demo">Load Demo Meeting</button>' +
        '<a class="btn" href="#/meetings/new">New meeting</a><a class="btn" href="#/kanban">Go to Kanban</a></div></div>';
    }
    var owners = C.knownOwners(st).concat([]);
    var filtersHtml = '<div class="filters" role="group" aria-label="Dashboard filters">' +
      sel('Meeting', 'meetingId', [['', 'All meetings']].concat(st.meetings.map(function (x) { return [x.id, x.title]; })), f.meetingId) +
      sel('Project', 'project', [['', 'All projects']].concat(C.knownProjects(st).map(function (p) { return [p, p]; })), f.project) +
      sel('Owner', 'owner', [['', 'All owners'], [C.UNASSIGNED, C.UNASSIGNED]].concat(owners.map(function (o) { return [o, o]; })), f.owner) +
      sel('Priority', 'priority', [['', 'All priorities'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], f.priority) +
      sel('Status', 'status', [['', 'All statuses']].concat(C.COLUMNS.map(function (c) { return [c.id, c.label]; })), f.status) +
      '<div class="field"><label for="df-dueFrom">Due from</label><input type="date" id="df-dueFrom" data-change="dash-filter" data-key="dueFrom" value="' + esc(f.dueFrom || '') + '"></div>' +
      '<div class="field"><label for="df-dueTo">Due to</label><input type="date" id="df-dueTo" data-change="dash-filter" data-key="dueTo" value="' + esc(f.dueTo || '') + '"></div>' +
      '<div class="field"><button class="btn" type="button" data-action="dash-reset">Reset filters</button></div></div>';
    function sel(label, key, options, cur) {
      return '<div class="field"><label for="df-' + key + '">' + esc(label) + '</label><select id="df-' + key + '" data-change="dash-filter" data-key="' + key + '">' +
        options.map(function (o) { return opt(o[0], o[1], cur || ''); }).join('') + '</select></div>';
    }
    function stat(n, label, cls) { return '<div class="stat ' + (cls || '') + '"><div class="stat-num">' + n + '</div><div class="stat-label">' + esc(label) + '</div></div>'; }
    var mm = m.meetings, tt = m.tasks;
    var total = tt.total;

    var statusBar = total ? '<div class="stackbar" role="img" aria-label="' + esc('Task status distribution: ' + C.COLUMNS.map(function (c) { return c.label + ' ' + m.byStatus[c.id]; }).join(', ')) + '">' +
      C.COLUMNS.map(function (c) { return m.byStatus[c.id] ? '<span style="width:' + (m.byStatus[c.id] / total * 100) + '%;background:' + STATUS_COLORS[c.id] + '"></span>' : ''; }).join('') + '</div>' +
      '<ul class="legend">' + C.COLUMNS.map(function (c) { return '<li><span class="sw" style="background:' + STATUS_COLORS[c.id] + '"></span>' + esc(c.label) + ': <b>' + m.byStatus[c.id] + '</b></li>'; }).join('') + '</ul>'
      : '<p class="muted">No tasks match these filters.</p>';

    var circ = 2 * Math.PI * 38, dash = circ * m.completionRate / 100;
    var ring = '<div class="ring-wrap"><svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Completion rate ' + m.completionRate + ' percent">' +
      '<circle cx="48" cy="48" r="38" fill="none" stroke="var(--surface-2)" stroke-width="12"/>' +
      '<circle cx="48" cy="48" r="38" fill="none" stroke="var(--s-completed)" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '" transform="rotate(-90 48 48)"/></svg>' +
      '<div><div class="ring-text">' + m.completionRate + '%</div><div class="muted small">' + tt.completed + ' of ' + total + ' tasks completed</div></div></div>';

    function bars(rows, nameKey, valKey, color, suffix) {
      var max = Math.max.apply(null, rows.map(function (r) { return r[valKey]; }).concat([1]));
      return '<ul class="barlist">' + rows.map(function (r) {
        return '<li><span class="name" title="' + esc(r[nameKey]) + '">' + esc(r[nameKey]) + '</span><span class="bar" aria-hidden="true"><span style="width:' + (r[valKey] / max * 100) + '%;background:' + (typeof color === 'function' ? color(r) : color) + '"></span></span><b>' + r[valKey] + (suffix ? suffix(r) : '') + '</b></li>';
      }).join('') + '</ul>';
    }
    var prioRows = ['High', 'Medium', 'Low'].map(function (p) { return { name: p, n: m.byPriority[p] }; });
    var ownerRows = m.byOwner.slice(0, 8);

    var recent = m.recentActivity.length ? '<ul class="activity">' + m.recentActivity.map(function (a) {
      return '<li><span>' + esc(C.describeActivity(a)) + '</span><time datetime="' + esc(a.at) + '">' + esc(C.formatTimestamp(a.at)) + '</time></li>';
    }).join('') + '</ul>' : '<p class="muted">No task activity yet.</p>';

    var attention = m.overdueTasks.length ? '<ul class="attn-list">' + m.overdueTasks.slice(0, 6).map(function (t) {
      return '<li><a href="#/kanban?task=' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a><span class="badge danger">' + esc(C.dueLabel(t, new Date())) + (t.column === 'hold' ? ' · on hold' : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="muted">Nothing is overdue.</p>';

    return '<div class="page-head"><div><h1>Dashboard</h1><p>Calculated from your saved meetings and tasks.</p></div>' +
      '<div class="actions"><a class="btn btn-primary" href="#/meetings/new">New meeting</a></div></div>' + filtersHtml +
      '<section class="stat-group" aria-labelledby="h-meet"><h2 id="h-meet">Meeting outcomes</h2><div class="stats">' +
      stat(mm.analyzed, 'Meetings analyzed') + stat(mm.decisions, 'Decisions recorded') + stat(mm.actionItemsExtracted, 'Action items extracted') + stat(mm.actionItemsApproved, 'Action items approved') +
      '</div>' + (f.meetingId || f.project ? '' : '') + '<p class="hint">Meeting figures respond to the Meeting and Project filters only.</p></section>' +
      '<section class="stat-group" aria-labelledby="h-task"><h2 id="h-task">Tasks</h2><div class="stats">' +
      stat(tt.total, 'Total tasks') + stat(tt.open, 'Open') + stat(tt.inprogress, 'In progress') + stat(tt.hold, 'On hold') + stat(tt.completed, 'Completed') +
      stat(tt.overdue, 'Overdue', tt.overdue ? 'alert' : '') + stat(tt.dueToday, 'Due today', tt.dueToday ? 'warn' : '') + stat(tt.unassigned, 'Unassigned (not completed)', tt.unassigned ? 'warn' : '') +
      '</div><p class="hint">Overdue = due date before today and not Completed (tasks On hold are included). Due today is not overdue.</p></section>' +
      '<div class="grid-2">' +
      '<section class="card" aria-labelledby="h-status"><div class="card-title"><h2 id="h-status">Status distribution</h2></div>' + statusBar + '</section>' +
      '<section class="card" aria-labelledby="h-rate"><div class="card-title"><h2 id="h-rate">Completion rate</h2></div>' + ring + '</section>' +
      '<section class="card" aria-labelledby="h-prio"><div class="card-title"><h2 id="h-prio">Priority distribution</h2></div>' + bars(prioRows, 'name', 'n', function (r) { return PRIO_COLORS[r.name]; }) + '</section>' +
      '<section class="card" aria-labelledby="h-owner"><div class="card-title"><h2 id="h-owner">Tasks by owner</h2></div>' +
      (ownerRows.length ? bars(ownerRows, 'owner', 'total', 'var(--accent)', function (r) { return ' <span class="muted small">(' + r.active + ' active)</span>'; }) : '<p class="muted">No tasks match these filters.</p>') + '</section>' +
      '<section class="card" aria-labelledby="h-od"><div class="card-title"><h2 id="h-od">Overdue by owner</h2></div>' +
      (m.overdueByOwner.length ? bars(m.overdueByOwner, 'owner', 'overdue', 'var(--danger)') : '<p class="muted">No overdue tasks.</p>') + '</section>' +
      '<section class="card" aria-labelledby="h-attn"><div class="card-title"><h2 id="h-attn">Needs attention</h2></div>' + attention + '</section>' +
      '<section class="card" aria-labelledby="h-act"><div class="card-title"><h2 id="h-act">Recent task activity</h2></div>' + recent + '</section>' +
      '</div>';
  }

  /* ================================================================== meetings list */
  function meetingStatusBadge(m) {
    if (m.analysis) return m.analysis.mode === 'ai' ? '<span class="badge ok">Analyzed · AI</span>' : '<span class="badge warn">Analyzed · Demo mode</span>';
    if (m.status === 'failed') return '<span class="badge danger">Analysis failed</span>';
    return '<span class="badge">Not analyzed</span>';
  }
  function viewMeetings() {
    var st = app.state, q = app.mSearch.trim().toLowerCase();
    var list = st.meetings.slice().sort(function (a, b) { return (b.startsAt || b.createdAt) < (a.startsAt || a.createdAt) ? -1 : 1; })
      .filter(function (m) { return !q || (m.title + ' ' + m.project + ' ' + (m.analysis ? m.analysis.summary : '')).toLowerCase().indexOf(q) >= 0; });
    var head = '<div class="page-head"><div><h1>Meetings</h1><p>Every analyzed meeting, with its decisions, actions and linked tasks.</p></div>' +
      '<div class="actions"><button class="btn" type="button" data-action="load-demo">Load Demo Meeting</button><a class="btn btn-primary" href="#/meetings/new">New meeting</a></div></div>';
    if (!st.meetings.length) {
      return head + '<div class="card empty"><h2>No meetings yet</h2><p>Paste a transcript to get a summary, decisions and action items you can review and send to the Kanban board.</p>' +
        '<div class="actions"><a class="btn btn-primary" href="#/meetings/new">New meeting</a><button class="btn" type="button" data-action="load-demo">Load Demo Meeting</button></div></div>';
    }
    var rows = list.map(function (m) {
      var a = m.analysis, tasks = C.tasksForMeeting(st, m.id).length;
      var extracted = a ? a.actionItems.filter(function (i) { return !i.manual; }).length : 0;
      return '<article class="card meeting-row"><div><h3><a href="#/meetings/' + esc(m.id) + '">' + esc(m.title) + '</a></h3>' +
        '<div class="meeting-meta">' + meetingStatusBadge(m) + (m.isDemo ? '<span class="badge info">Sample data</span>' : '') +
        (m.startsAt ? '<span>' + esc(C.formatDateTime(m.startsAt)) + '</span>' : '') +
        (m.project ? '<span>' + esc(m.project) + '</span>' : '') +
        (m.participants.length ? '<span>' + plural(m.participants.length, 'participant') + '</span>' : '') + '</div>' +
        '<p class="preview">' + (a && a.summary ? esc(a.summary) : '<span class="muted">No summary yet — open the meeting and click Analyze.</span>') + '</p></div>' +
        '<div class="counts" aria-label="Meeting totals"><div><b>' + (a ? a.decisions.length : 0) + '</b><span>decisions</span></div><div><b>' + extracted + '</b><span>actions</span></div><div><b>' + tasks + '</b><span>tasks</span></div></div></article>';
    }).join('');
    return head + '<div class="field" style="max-width:360px"><label for="m-search">Search meetings</label><input type="search" id="m-search" data-input="m-search" placeholder="Title, project or summary" value="' + esc(app.mSearch) + '"></div>' +
      '<div class="meeting-list">' + (rows || '<div class="card empty"><p>No meetings match “' + esc(app.mSearch) + '”.</p></div>') + '</div>';
  }

  /* ================================================================== meeting detail / editor */
  function currentMeeting() {
    var r = app.route;
    if (r.id === 'new') {
      if (!app.draft) app.draft = { title: '', startsAt: C.toISODate(new Date()) + 'T' + ('0' + new Date().getHours()).slice(-2) + ':00', participants: [], project: '', transcript: '' };
      return Object.assign({ id: null, status: 'draft', analysis: null, analysisHistory: [], isDemo: false }, app.draft);
    }
    return meetingOf(r.id);
  }
  function modeOptions() {
    var h = app.health, live = h && h.ai_configured;
    var autoLabel = live ? 'Default: live AI (' + h.provider_label + ' · ' + h.model + ')' : 'Default: Demo mode (rule-based, no AI key configured)';
    return opt('auto', autoLabel, app.formMode) + opt('ai', 'Live AI' + (live ? '' : ' (not configured)'), app.formMode, !live) + opt('demo', 'Demo mode (rule-based, not AI)', app.formMode);
  }
  function viewMeeting() {
    var m = currentMeeting();
    if (!m) return '<div class="card empty"><h2>Meeting not found</h2><p>It may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/meetings">Back to meetings</a></div></div>';
    var isNew = !m.id, key = m.id || 'new', a = m.analysis, busy = !!app.analyzing[key], err = app.errors[key];
    var dup = '';
    var disc = app.health ? app.health.disclosure : 'Checking the analysis server…';
    var owners = C.knownOwners(app.state, m.participants.concat(C.speakersOf(m.transcript)));
    var changed = a && a.transcriptHash && a.transcriptHash !== C.hashText(m.transcript);
    var head = '<div class="page-head"><div><p class="small"><a href="#/meetings">← All meetings</a></p><h1>' + (isNew ? 'New meeting' : esc(m.title)) + '</h1>' +
      (m.isDemo ? '<p><span class="badge info">Sample data — fictional people, projects and deadlines</span></p>' : '') + '</div>' +
      '<div class="actions">' + (isNew ? '<button class="btn" type="button" data-action="load-demo">Load Demo Meeting</button>' : '<button class="btn btn-danger" type="button" data-action="delete-meeting">Delete meeting</button>') + '</div></div>';
    var details = '<section class="card" aria-labelledby="h-details"><div class="card-title"><h2 id="h-details">Meeting details</h2></div>' +
      '<div class="field-row"><div class="field"><label for="mt-title">Title</label><input type="text" id="mt-title" data-change="meeting-field" data-field="title" maxlength="200" value="' + esc(m.title) + '" placeholder="e.g. Weekly product sync"></div>' +
      '<div class="field"><label for="mt-start">Date and time</label><input type="datetime-local" id="mt-start" data-change="meeting-field" data-field="startsAt" value="' + esc(m.startsAt) + '"></div></div>' +
      '<div class="field-row"><div class="field"><label for="mt-people">Participants (optional)</label><input type="text" id="mt-people" data-change="meeting-field" data-field="participants" value="' + esc(m.participants.join(', ')) + '" placeholder="Priya Nair, Marcus Lee"><div class="hint">Comma-separated. Helps match owners to people named in the transcript.</div></div>' +
      '<div class="field"><label for="mt-project">Department or project (optional)</label><input type="text" id="mt-project" data-change="meeting-field" data-field="project" maxlength="200" value="' + esc(m.project) + '"></div></div></section>';
    var verb = a ? 'Re-analyze transcript' : 'Analyze transcript';
    var transcriptCard = '<section class="card" aria-labelledby="h-transcript"><div class="card-title"><h2 id="h-transcript">Transcript</h2>' +
      '<div class="actions"><label class="btn btn-sm" for="mt-file" style="margin:0;cursor:pointer">Upload .txt</label><input type="file" id="mt-file" accept=".txt,text/plain" class="sr-only" data-change="upload"></div></div>' +
      '<div class="field"><label for="mt-transcript" class="sr-only">Transcript text</label><textarea id="mt-transcript" data-change="meeting-field" data-input="count" data-field="transcript" rows="' + (a ? 6 : 14) + '" placeholder="Paste the meeting transcript here. A “Name: text” format per line works best.">' + esc(m.transcript) + '</textarea>' +
      '<div class="hint"><span id="mt-count">' + m.transcript.length.toLocaleString('en-US') + '</span> / ' + ((app.health && app.health.max_transcript_chars) || C.MAX_TRANSCRIPT_CHARS).toLocaleString('en-US') + ' characters</div>' +
      (app.formError ? '<div class="field-error" role="alert" id="mt-error">' + esc(app.formError) + '</div>' : '') +
      (changed ? '<div class="hint" style="color:var(--warn);font-weight:600">The transcript was edited after the current analysis. Re-analyze to refresh the results.</div>' : '') + '</div>' +
      '<div class="privacy" id="mt-privacy">' + esc(disc) + '</div>' +
      '<div class="field-row"><div class="field"><label for="mt-mode">Analysis mode</label><select id="mt-mode" data-change="mode">' + modeOptions() + '</select></div>' +
      '<div class="field" style="align-self:end"><div class="actions"><button class="btn btn-primary" type="button" id="btn-analyze" data-action="analyze"' + (busy ? ' disabled aria-busy="true"' : '') + '>' +
      (busy ? '<span class="spinner" aria-hidden="true"></span> Analyzing…' : verb) + '</button><button class="btn" type="button" data-action="save-meeting"' + (busy ? ' disabled' : '') + '>' + (isNew ? 'Save without analyzing' : 'Save changes') + '</button></div></div></div>' +
      (busy ? '<div class="loading-box" role="status"><span class="spinner" aria-hidden="true"></span><span>Analyzing the transcript. This can take up to a minute. You can keep this page open.</span></div>' : '') +
      (err ? '<div class="err-box" role="alert"><div>' + esc(err.message) + '</div><div class="actions"><button class="btn btn-sm" type="button" data-action="analyze">Try again</button>' +
        (err.suggestDemo ? '<button class="btn btn-sm" type="button" data-action="analyze-demo">Analyze in Demo mode</button>' : '') + '</div></div>' : '') +
      (!isNew && m.status === 'failed' && !err && m.lastError ? '<div class="err-box" role="alert">The last analysis failed: ' + esc(m.lastError) + '</div>' : '') + '</section>';

    var body = '';
    if (a) body = viewAnalysis(m, owners);
    else if (!isNew) body = '<div class="card empty"><h2>No analysis yet</h2><p>Click “Analyze transcript” to generate a summary, decisions and proposed action items. Nothing becomes a task until you approve it.</p>' +
      '<div class="actions"><button class="btn" type="button" data-action="add-item">Add an action item manually</button></div></div>';
    return head + details + transcriptCard + body + '<datalist id="owner-list">' + owners.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>';
  }

  function listOrNone(items, none) {
    return items.length ? '<ul class="section-list">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted small">' + esc(none || 'None identified.') + '</p>';
  }
  function viewAnalysis(m) {
    var a = m.analysis, tasks = C.tasksForMeeting(app.state, m.id);
    var label = a.mode === 'ai' ? '<span class="badge ok">AI analysis · ' + esc((a.provider || '') + (a.model ? ' · ' + a.model : '')) + '</span>' : '<span class="badge warn">Demo mode · rule-based, not AI</span>';
    var out = '<section class="card" aria-labelledby="h-summary"><div class="card-title"><h2 id="h-summary">Executive summary</h2><div class="actions">' + label +
      '<span class="muted small">Generated ' + esc(C.formatTimestamp(a.generatedAt)) + '</span></div></div>' +
      '<p class="hint" style="margin:0 0 8px">Automated output can contain mistakes. Check it against the transcript before approving anything.</p>' +
      (a.summary ? '<p>' + esc(a.summary) + '</p>' : '<p class="muted">No summary was produced.</p>') +
      (a.mainTopics.length ? '<p style="margin-top:8px">' + a.mainTopics.map(function (t) { return '<span class="badge info" style="margin-right:4px">' + esc(t) + '</span>'; }).join('') + '</p>' : '') +
      (a.warnings.length ? '<ul class="reasons">' + a.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="notes-grid" style="margin-top:12px"><div><h3>Main outcomes</h3>' + listOrNone(a.outcomes) + '</div><div><h3>Unresolved questions and blockers</h3>' + listOrNone(a.unresolved) + '</div></div></section>';

    out += '<section class="card" aria-labelledby="h-decisions"><div class="card-title"><h2 id="h-decisions">Decisions (' + a.decisions.length + ')</h2></div>' +
      (a.decisions.length ? a.decisions.map(function (d) {
        return '<div class="decision"><div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><strong>' + esc(d.description) + '</strong>' +
          (d.status === 'confirmed' ? '<span class="badge ok">Confirmed</span>' : '<span class="badge warn">Needs clarification</span>') + '</div>' +
          (d.topic ? '<div class="small muted">' + esc(d.topic) + '</div>' : '') +
          (d.evidence ? '<blockquote class="evidence">“' + esc(d.evidence) + '”</blockquote><button class="btn btn-sm btn-ghost" type="button" data-action="show-evidence" data-excerpt="' + esc(d.evidence) + '">Show in transcript</button>' : '') + '</div>';
      }).join('') : '<p class="muted">No confirmed decisions were found. Suggestions and open discussion are deliberately not treated as decisions.</p>') + '</section>';

    out += viewReview(m);

    out += '<section class="card" aria-labelledby="h-notes"><div class="card-title"><h2 id="h-notes">Discussion notes</h2></div><div class="notes-grid">' +
      '<div><h3>Discussion points</h3>' + listOrNone(a.discussionPoints) + '</div><div><h3>Risks</h3>' + listOrNone(a.risks) + '</div>' +
      '<div><h3>Blockers</h3>' + listOrNone(a.blockers) + '</div><div><h3>Dependencies</h3>' + listOrNone(a.dependencies) + '</div>' +
      '<div><h3>Open questions</h3>' + listOrNone(a.openQuestions) + '</div></div></section>';

    out += '<section class="card" aria-labelledby="h-missing"><div class="card-title"><h2 id="h-missing">Missing information</h2></div>' +
      listOrNone(a.missingInformation, 'Nothing flagged as missing.') + '</section>';

    out += '<section class="card" aria-labelledby="h-linked"><div class="card-title"><h2 id="h-linked">Linked tasks (' + tasks.length + ')</h2><a class="btn btn-sm" href="#/kanban">Open Kanban</a></div>' +
      (tasks.length ? '<ul class="attn-list">' + tasks.map(function (t) {
        return '<li><a href="#/kanban?task=' + encodeURIComponent(t.id) + '">' + esc(t.title) + '</a><span>' + statusChip(t) + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted">No tasks yet. Approve action items above to create them.</p>') + '</section>';

    if (m.analysisHistory.length) {
      out += '<section class="card" aria-labelledby="h-hist"><div class="card-title"><h2 id="h-hist">Previous analyses (' + m.analysisHistory.length + ')</h2></div>' +
        '<p class="hint" style="margin-bottom:8px">Re-analyzing never overwrites earlier results. Tasks created from them stay on the board.</p>' +
        m.analysisHistory.map(function (h) {
          return '<details><summary>' + esc(C.formatTimestamp(h.generatedAt)) + ' · ' + esc(h.mode === 'ai' ? 'AI' : 'Demo mode') + ' · ' + plural(h.decisions.length, 'decision') + ', ' + plural(h.actionItems.length, 'action item') + '</summary>' +
            '<p>' + esc(h.summary) + '</p><ul class="section-list">' + h.actionItems.map(function (i) { return '<li>' + esc(i.title) + ' <span class="muted small">(' + esc(i.owner) + ' · ' + esc(i.status) + ')</span></li>'; }).join('') + '</ul></details>';
        }).join('') + '</section>';
    }

    var ev = app.showEvidence && app.showEvidence.meetingId === m.id ? app.showEvidence.excerpt : null;
    var parts = ev ? C.highlightParts(m.transcript, ev) : null;
    var tHtml = parts ? parts.map(function (p) { return p.mark ? '<mark>' + esc(p.text) + '</mark>' : esc(p.text); }).join('') : esc(m.transcript);
    out += '<section class="card" aria-labelledby="h-full"><details' + (ev ? ' open' : '') + '><summary id="h-full">Saved transcript</summary>' +
      (ev && !parts ? '<p class="hint" style="color:var(--warn)">That excerpt could not be located in the transcript text.</p>' : '') +
      '<div class="transcript" tabindex="0" aria-label="Transcript text">' + tHtml + '</div></details></section>';
    return out;
  }

  function confidenceLabel(c) { if (c == null) return ''; var l = c >= 0.8 ? 'High' : c >= 0.6 ? 'Medium' : 'Low'; return 'Confidence: ' + l + ' (' + Math.round(c * 100) + '%)'; }

  function viewReview(m) {
    var a = m.analysis, items = a.actionItems, sel = app.selected[m.id] || {};
    var drafts = items.filter(function (i) { return i.status === 'draft'; });
    var nSel = drafts.filter(function (i) { return sel[i.id]; }).length;
    var counts = { draft: drafts.length, approved: items.filter(function (i) { return i.status === 'approved'; }).length, rejected: items.filter(function (i) { return i.status === 'rejected'; }).length };
    var bulk = '<div class="bulkbar" role="group" aria-label="Bulk actions">' +
      '<label style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" id="sel-all" data-change="select-all"' + (drafts.length && nSel === drafts.length ? ' checked' : '') + (drafts.length ? '' : ' disabled') + '> Select all drafts</label>' +
      '<span class="grow muted small" id="sel-count" aria-live="polite">' + nSel + ' selected</span>' +
      '<button class="btn btn-sm btn-primary" type="button" id="btn-approve-sel" data-action="approve-selected"' + (nSel ? '' : ' disabled') + '>Approve selected</button>' +
      '<button class="btn btn-sm btn-primary" type="button" id="btn-approve-all" data-action="approve-all"' + (drafts.length ? '' : ' disabled') + '>Approve all remaining (' + drafts.length + ')</button>' +
      '<button class="btn btn-sm" type="button" id="btn-reject-sel" data-action="reject-selected"' + (nSel ? '' : ' disabled') + '>Reject selected</button>' +
      '<button class="btn btn-sm" type="button" data-action="add-item">+ Add action item</button></div>';
    var list = items.length ? items.map(function (i) { return itemHTML(m, i, !!sel[i.id]); }).join('') :
      '<p class="muted">No action items were found. You can add one manually.</p>';
    return '<section class="card" id="review" aria-labelledby="h-actions"><div class="card-title"><h2 id="h-actions">Action items</h2>' +
      '<div class="actions"><span class="badge warn">' + counts.draft + ' draft</span><span class="badge ok">' + counts.approved + ' approved</span><span class="badge">' + counts.rejected + ' rejected</span></div></div>' +
      '<p class="hint" style="margin:0 0 10px">Review and edit each suggestion. Nothing is added to the Kanban board until you approve it.</p>' + bulk + list + '</section>';
  }

  function itemHTML(m, i, selected) {
    var locked = i.status !== 'draft', task = i.taskId ? app.state.tasks.filter(function (t) { return t.id === i.taskId; })[0] : null;
    var statusBadge = i.status === 'approved' ? '<span class="badge ok">Approved</span>' : i.status === 'rejected' ? '<span class="badge">Rejected</span>' : '<span class="badge warn">Draft</span>';
    var flag = i.status === 'draft' ? (i.needsReview && !i.reviewed ? '<span class="badge danger">Needs review</span>' : (i.reviewed ? '<span class="badge ok">Reviewed</span>' : '')) : '';
    var f = 'data-change="item-field" data-item="' + esc(i.id) + '"';
    var dis = locked ? ' disabled' : '';
    var title = '<input type="text" class="item-title" aria-label="Action title" data-field="title" ' + f + ' value="' + esc(i.title) + '" maxlength="200"' + dis + '>';
    var fields = '<div class="item-fields"><div class="wide"><label for="d-' + esc(i.id) + '">Description</label><textarea id="d-' + esc(i.id) + '" rows="2" data-field="description" ' + f + dis + '>' + esc(i.description) + '</textarea></div>' +
      '<div><label for="o-' + esc(i.id) + '">Owner</label><input type="text" id="o-' + esc(i.id) + '" list="owner-list" data-field="owner" ' + f + ' value="' + esc(i.owner) + '"' + dis + '></div>' +
      '<div><label for="dd-' + esc(i.id) + '">Due date</label><input type="date" id="dd-' + esc(i.id) + '" data-field="dueDate" ' + f + ' value="' + esc(i.dueDate || '') + '"' + dis + '>' +
      (i.dueText ? '<div class="field-note">Said in the meeting: “' + esc(i.dueText) + '”</div>' : (i.dueDate ? '' : '<div class="field-note">No deadline stated.</div>')) + '</div>' +
      '<div><label for="p-' + esc(i.id) + '">Priority</label><select id="p-' + esc(i.id) + '" data-field="priority" ' + f + dis + '>' + C.PRIORITIES.slice().reverse().map(function (p) { return opt(p, p, i.priority); }).join('') + '</select></div></div>';
    var reasons = i.status === 'draft' && !i.reviewed && i.reviewReasons.length ? '<ul class="reasons" aria-label="Review warnings">' + i.reviewReasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '';
    var evidence = i.evidence ? '<blockquote class="evidence">“' + esc(i.evidence) + '”</blockquote>' +
      (i.evidenceVerified ? '<button class="btn btn-sm btn-ghost" type="button" data-action="show-evidence" data-excerpt="' + esc(i.evidence) + '" data-item="' + esc(i.id) + '">Show in transcript</button>' : '<span class="badge warn">Excerpt not verified in transcript</span>')
      : (i.manual ? '<p class="muted small">Added manually — no transcript evidence.</p>' : '<span class="badge warn">No transcript excerpt</span>');
    var foot = '';
    if (i.status === 'draft') foot = '<button class="btn btn-sm btn-primary" type="button" data-action="approve-item" data-item="' + esc(i.id) + '">Approve</button>' +
      (i.needsReview && !i.reviewed ? '<button class="btn btn-sm" type="button" data-action="mark-reviewed" data-item="' + esc(i.id) + '">Mark reviewed</button>' : '') +
      '<button class="btn btn-sm" type="button" data-action="reject-item" data-item="' + esc(i.id) + '">Reject</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-action="delete-item" data-item="' + esc(i.id) + '">Delete</button>';
    else if (i.status === 'rejected') foot = '<button class="btn btn-sm" type="button" data-action="restore-item" data-item="' + esc(i.id) + '">Restore</button><button class="btn btn-sm btn-danger" type="button" data-action="delete-item" data-item="' + esc(i.id) + '">Delete</button>';
    else foot = task ? '<a class="btn btn-sm" href="#/kanban?task=' + encodeURIComponent(task.id) + '">View task on Kanban (' + esc(C.columnLabel(task.column)) + ')</a><span class="muted small">Edit approved work on the board.</span>' : '';
    return '<article class="item ' + esc(i.status) + '" id="item-' + esc(i.id) + '" data-item-id="' + esc(i.id) + '">' +
      '<div class="item-head">' + (i.status === 'draft' ? '<input type="checkbox" aria-label="Select action item ' + esc(i.title) + '" data-change="select-item" data-item="' + esc(i.id) + '"' + (selected ? ' checked' : '') + '>' : '') +
      '<div class="grow">' + title + '</div>' + statusBadge + flag +
      (i.confidence != null && i.status === 'draft' ? '<span class="badge" title="An estimate, not a guarantee">' + esc(confidenceLabel(i.confidence)) + '</span>' : '') +
      (i.topic ? '<span class="badge info">' + esc(i.topic) + '</span>' : '') + '</div>' + fields + reasons + evidence + '<div class="item-foot">' + foot + '</div></article>';
  }

  /* ================================================================== kanban */
  function statusChip(t) {
    var col = C.columnLabel(t.column), ds = C.dueState(t, new Date());
    return '<span class="badge" style="background:transparent;border:1px solid var(--border-2)"><span class="dot" style="background:' + STATUS_COLORS[t.column] + '"></span>' + esc(col) + '</span>' +
      (ds === 'overdue' ? ' <span class="badge danger">' + esc(C.dueLabel(t, new Date())) + '</span>' : '');
  }
  function viewKanban() {
    var st = app.state, now = new Date(), f = app.kFilters;
    var visible = C.filterTasks(st.tasks, f, now, app.kSearch);
    var owners = C.knownOwners(st);
    var filtersActive = app.kSearch || f.owner || f.priority || f.meetingId;
    var toolbar = '<div class="toolbar" role="search" aria-label="Filter tasks"><div class="field grow"><label for="k-search">Search tasks</label><input type="search" id="k-search" data-input="k-search" placeholder="Title, description, owner" value="' + esc(app.kSearch) + '"></div>' +
      '<div class="field"><label for="k-owner">Owner</label><select id="k-owner" data-change="k-filter" data-key="owner">' + opt('', 'All owners', f.owner || '') + opt(C.UNASSIGNED, C.UNASSIGNED, f.owner || '') + owners.map(function (o) { return opt(o, o, f.owner || ''); }).join('') + '</select></div>' +
      '<div class="field"><label for="k-priority">Priority</label><select id="k-priority" data-change="k-filter" data-key="priority">' + opt('', 'All priorities', f.priority || '') + ['High', 'Medium', 'Low'].map(function (p) { return opt(p, p, f.priority || ''); }).join('') + '</select></div>' +
      '<div class="field"><label for="k-meeting">Source meeting</label><select id="k-meeting" data-change="k-filter" data-key="meetingId">' + opt('', 'All tasks', f.meetingId || '') + st.meetings.map(function (m) { return opt(m.id, m.title, f.meetingId || ''); }).join('') + '</select></div>' +
      (filtersActive ? '<div class="field"><button class="btn" type="button" data-action="k-clear">Clear filters</button></div>' : '') + '</div>';
    var cols = C.COLUMNS.map(function (col) {
      var all = st.tasks.filter(function (t) { return t.column === col.id; }), cards = visible.filter(function (t) { return t.column === col.id; });
      return '<div class="col" data-col="' + col.id + '" role="group" aria-label="' + esc(col.label) + ' column"><div class="col-header"><h2 class="col-label"><span class="dot" style="background:' + STATUS_COLORS[col.id] + '"></span>' + esc(col.label) + '</h2>' +
        '<span class="col-count" aria-label="' + (filtersActive ? cards.length + ' of ' + all.length : all.length) + ' tasks">' + (filtersActive ? cards.length + '/' + all.length : all.length) + '</span></div>' +
        '<div class="cards">' + cards.map(function (t) { return cardHTML(t, now); }).join('') + '</div>' +
        (app.addingTo === col.id ? quickForm(col.id) : '<button class="add-btn" type="button" data-action="add-card" data-col="' + col.id + '"><span aria-hidden="true" style="font-size:16px">+</span> Add a card</button>') + '</div>';
    }).join('');
    var empty = !st.tasks.length ? '<div class="card empty" style="margin-bottom:12px"><h2>Your board is empty</h2><p>Add a card in any column, or turn a meeting into tasks.</p><div class="actions"><a class="btn btn-primary" href="#/meetings/new">New meeting</a><button class="btn" type="button" data-action="load-demo">Load Demo Meeting</button></div></div>' : '';
    return '<div class="page-head"><div><h1>Kanban board</h1><p>Drag cards between columns, or use the ··· menu to move them with the keyboard.</p></div></div>' + toolbar + empty + '<div class="grid">' + cols + '</div>';
  }
  function cardHTML(t, now) {
    var ds = C.dueState(t, now), src = t.sourceMeetingId ? meetingOf(t.sourceMeetingId) : null;
    var chips = '<span class="badge p-' + esc(t.priority) + '"><span class="dot"></span>' + esc(t.priority) + (t.priority === 'High' ? ' priority' : '') + '</span>';
    if (t.dueDate) {
      var cls = ds === 'overdue' ? 'danger' : ds === 'today' ? 'warn' : ds === 'soon' ? 'info' : '';
      chips += ' <span class="badge ' + cls + '" title="Due ' + esc(C.formatDate(t.dueDate)) + '">' + esc(C.dueLabel(t, now)) + (ds === 'overdue' && t.column === 'hold' ? ' · on hold' : '') + '</span>';
      if (t.column === 'completed') chips += ' <span class="badge ok">Done</span>';
    }
    if (!t.assignee && t.column !== 'completed') chips += ' <span class="badge warn">Unassigned</span>';
    var menu = app.openMenu === t.id ? '<div class="dropdown" role="menu"><button class="drop-btn" role="menuitem" type="button" data-action="edit-task" data-task="' + esc(t.id) + '">✏️ Edit</button>' +
      '<div class="drop-sep">Move to</div>' + C.COLUMNS.filter(function (c) { return c.id !== t.column; }).map(function (c) { return '<button class="drop-btn" role="menuitem" type="button" data-action="move-task" data-task="' + esc(t.id) + '" data-col="' + c.id + '">' + esc(c.label) + '</button>'; }).join('') +
      '<div class="drop-sep"></div><button class="drop-btn" role="menuitem" style="color:var(--danger)" type="button" data-action="delete-task" data-task="' + esc(t.id) + '">🗑️ Delete</button></div>' : '';
    return '<div class="kcard' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : '') + '" draggable="true" data-task-id="' + esc(t.id) + '">' +
      '<div class="kcard-top"><button class="kcard-title" type="button" data-action="edit-task" data-task="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
      '<div class="menu-wrap"><button class="menu-btn" type="button" aria-haspopup="menu" aria-expanded="' + (app.openMenu === t.id) + '" aria-label="Actions for ' + esc(t.title) + '" data-action="toggle-menu" data-task="' + esc(t.id) + '">···</button>' + menu + '</div></div>' +
      '<div class="kcard-chips">' + chips + '</div><div class="kcard-bottom">' + (t.assignee ? '<span class="assignee-name" style="margin:0">' + esc(t.assignee) + '</span><div class="avatar" style="background:' + avatarColor(t.assignee) + '" title="' + esc(t.assignee) + '">' + esc(initials(t.assignee)) + '</div>' : '<span class="muted small">No assignee</span><div class="avatar avatar-empty" aria-hidden="true">👤</div>') + '</div>' +
      (t.sourceMeetingId ? '<div class="kcard-src">' + (src ? '<a href="#/meetings/' + esc(src.id) + '?item=' + encodeURIComponent(t.sourceActionId || '') + '">From meeting: ' + esc(src.title) + '</a>' : '<span class="muted">Source meeting was deleted</span>') + '</div>' : '') + '</div>';
  }
  function quickForm(col) {
    return '<div class="qform" data-qform="' + col + '"><div><label class="sr-only" for="q-title">Card title</label><input type="text" id="q-title" placeholder="Card title…" maxlength="200" data-autofocus></div>' +
      '<div><div class="label">Priority</div><div class="prio-btns" id="q-prio" role="group" aria-label="Priority">' + ['Low', 'Medium', 'High'].map(function (p) { return '<button type="button" class="prio-btn' + (p === 'Medium' ? ' sel-Medium' : '') + '" aria-pressed="' + (p === 'Medium') + '" data-action="q-prio" data-p="' + p + '">' + p + '</button>'; }).join('') + '</div></div>' +
      '<div><label for="q-assignee">Assigned to</label><input type="text" id="q-assignee" list="owner-list-k" placeholder="Name (optional)" maxlength="120"></div>' +
      '<div><label for="q-due">Due date</label><input type="date" id="q-due"></div>' +
      '<div class="form-actions"><button class="btn btn-primary btn-sm" type="button" data-action="q-save" data-col="' + col + '">Add card</button><button class="btn btn-ghost btn-sm" type="button" data-action="q-cancel" aria-label="Cancel">✕</button></div>' +
      '<datalist id="owner-list-k">' + C.knownOwners(app.state).map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist></div>';
  }

  /* ---------------------------------------------------------------- task modal */
  function openTaskModal(id) {
    var t = app.state.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var src = t.sourceMeetingId ? meetingOf(t.sourceMeetingId) : null;
    var html = '<div class="field"><label for="t-title">Title</label><input type="text" id="t-title" maxlength="200" value="' + esc(t.title) + '"></div>' +
      '<div class="field"><label for="t-desc">Description</label><textarea id="t-desc" rows="3">' + esc(t.description) + '</textarea></div>' +
      '<div class="field-row"><div class="field"><label for="t-col">Status</label><select id="t-col">' + C.COLUMNS.map(function (c) { return opt(c.id, c.label, t.column); }).join('') + '</select></div>' +
      '<div class="field"><label for="t-prio">Priority</label><select id="t-prio">' + ['High', 'Medium', 'Low'].map(function (p) { return opt(p, p, t.priority); }).join('') + '</select></div></div>' +
      '<div class="field-row"><div class="field"><label for="t-assignee">Assignee</label><input type="text" id="t-assignee" list="owner-list-t" maxlength="120" value="' + esc(t.assignee) + '"></div>' +
      '<div class="field"><label for="t-due">Due date</label><input type="date" id="t-due" value="' + esc(t.dueDate || '') + '"></div></div>' +
      '<div class="field"><label for="t-project">Project</label><input type="text" id="t-project" maxlength="200" value="' + esc(t.project) + '"></div>' +
      '<datalist id="owner-list-t">' + C.knownOwners(app.state).map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>' +
      (t.sourceMeetingId ? '<div class="modal-sec"><h3>Source</h3>' + (src ? '<p><a href="#/meetings/' + esc(src.id) + '?item=' + encodeURIComponent(t.sourceActionId || '') + '" data-x="open-source">' + esc(src.title) + '</a> <span class="muted small">' + esc(C.formatDateTime(src.startsAt)) + '</span></p>' : '<p class="muted">The source meeting was deleted.</p>') +
        (t.sourceEvidence ? '<blockquote class="evidence">“' + esc(t.sourceEvidence) + '”</blockquote>' : '') + '</div>' : '') +
      '<dl class="meta-grid modal-sec"><dt>Created</dt><dd>' + esc(C.formatTimestamp(t.createdAt)) + '</dd><dt>Last updated</dt><dd>' + esc(C.formatTimestamp(t.updatedAt)) + '</dd>' +
      (t.completedAt ? '<dt>Completed</dt><dd>' + esc(C.formatTimestamp(t.completedAt)) + '</dd>' : '') + '</dl>' +
      '<div id="t-error" class="field-error" role="alert"></div>' +
      '<div class="modal-actions"><button class="btn btn-danger" type="button" data-x="delete" style="margin-right:auto">Delete</button><button class="btn" type="button" data-x="cancel">Cancel</button><button class="btn btn-primary" type="button" data-x="save">Save changes</button></div>';
    openModal({
      title: 'Edit task', html: html,
      onMount: function (h) {
        h.el.addEventListener('click', async function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          var x = b.dataset.x;
          if (x === 'cancel') h.close(false);
          else if (x === 'open-source') { h.close(false); }
          else if (x === 'save') {
            var title = $('#t-title', h.el).value.trim();
            if (!title) { $('#t-error', h.el).textContent = 'A task needs a title.'; $('#t-title', h.el).focus(); return; }
            var next = C.updateTask(app.state, id, {
              title: title, description: $('#t-desc', h.el).value, column: $('#t-col', h.el).value, priority: $('#t-prio', h.el).value,
              assignee: $('#t-assignee', h.el).value, dueDate: $('#t-due', h.el).value || null, project: $('#t-project', h.el).value
            }, new Date());
            h.close(true); commit(next); toast('Task saved', 'success');
          } else if (x === 'delete') {
            var ok = await confirmDialog({ title: 'Delete this task?', message: '“' + t.title + '” will be removed from the board. This cannot be undone.' + (t.sourceMeetingId ? ' Its source action item returns to Draft in the meeting.' : ''), confirmLabel: 'Delete task', danger: true });
            if (ok) { h.close(true); commit(C.deleteTask(app.state, id, new Date())); toast('Task deleted'); }
          }
        });
      },
      onClose: function () { if (app.route.name === 'kanban' && app.route.task) { history.replaceState(null, '', '#/kanban'); app.route = parseHash(); } }
    });
  }

  /* ================================================================== analysis flow */
  function readMeetingForm() {
    return {
      title: ($('#mt-title') || {}).value || '', startsAt: ($('#mt-start') || {}).value || '',
      participants: C.parseList(($('#mt-people') || {}).value), project: (($('#mt-project') || {}).value || '').trim(),
      transcript: ($('#mt-transcript') || {}).value || ''
    };
  }
  function saveMeetingForm(silent) {
    var f = readMeetingForm(), r = app.route;
    if (r.id === 'new') { app.draft = f; return null; }
    if (!meetingOf(r.id)) return null;
    commit(C.updateMeeting(app.state, r.id, f, new Date()), { noRender: true });
    return r.id;
  }
  function friendly(err, status) {
    var code = err && err.code, msg = err && err.message;
    if (code === 'network') return { message: 'Could not reach the analysis server. If you opened this page as a file, start the backend first (see README: python run.py). Your Kanban board still works, and you can add action items manually.', suggestDemo: false };
    if (code === 'timeout') return { message: 'The analysis took too long and was stopped. Try again, shorten the transcript, or use Demo mode.', suggestDemo: true };
    var demo = ['ai_not_configured', 'ai_rate_limited', 'ai_timeout', 'ai_unreachable', 'ai_provider_error', 'ai_auth_failed', 'ai_bad_request', 'malformed_ai_response', 'ai_blocked'].indexOf(code) >= 0;
    var extra = code === 'ai_rate_limited' && err.retry_after ? ' (suggested wait: ' + err.retry_after + ' seconds)' : '';
    return { message: (msg || 'The analysis failed (HTTP ' + status + '). Please try again.') + extra, suggestDemo: demo };
  }

  async function analyze(forceMode) {
    var r = app.route, key = r.id || 'new';
    if (app.analyzing[key]) return;                 // duplicate-submission guard
    var form = readMeetingForm(), limit = app.health && app.health.max_transcript_chars;
    var v = C.validateTranscript(form.transcript, limit);
    if (!v.ok) { app.formError = v.error; render(); var ta = $('#mt-transcript'); if (ta) ta.focus(); return; }
    app.formError = null;
    var mode = forceMode || ($('#mt-mode') || {}).value || app.formMode || 'auto';
    app.formMode = mode;
    var existing = r.id === 'new' ? null : meetingOf(r.id);
    if (existing && existing.analysis) {
      var hasApproved = existing.analysis.actionItems.some(function (i) { return i.status === 'approved'; });
      var okr = await confirmDialog({ title: 'Re-analyze this meeting?', message: 'The current analysis is kept under “Previous analyses”.' + (hasApproved ? ' Tasks you already created stay on the board; matching new suggestions are flagged as possible duplicates.' : '') + ' New suggestions will appear as drafts.', confirmLabel: 'Re-analyze' });
      if (!okr) return;
    }
    var dup = C.findDuplicateMeeting(app.state, v.text, existing && existing.id);
    if (dup) toast('This transcript matches the saved meeting “' + dup.title + '”. Analyzing anyway.', 'info', 7000);

    var mid;
    if (r.id === 'new') {
      var title = form.title.trim() || 'Untitled meeting';
      var added = C.addMeeting(app.state, Object.assign({}, form, { title: title, transcript: v.text }), new Date());
      mid = added.meeting.id; app.draft = null; commit(added.state, { noRender: true });
    } else {
      mid = r.id; commit(C.updateMeeting(app.state, mid, Object.assign({}, form, { transcript: v.text }), new Date()), { noRender: true });
    }
    key = mid; app.analyzing[mid] = true; delete app.errors[mid];
    if (r.id === 'new') { history.replaceState(null, '', '#/meetings/' + mid); app.route = parseHash(); }
    render();

    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, ANALYZE_TIMEOUT_MS);
    var m = meetingOf(mid);
    try {
      var res;
      try {
        res = await fetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ transcript: v.text, title: m.title, meeting_date: m.startsAt || null, participants: m.participants, project: m.project, mode: mode })
        });
      } catch (e) { throw { code: e && e.name === 'AbortError' ? 'timeout' : 'network' }; }
      var data = null; try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) { var er = (data && data.error) || {}; throw { code: er.code || 'http_' + res.status, message: er.message, retry_after: er.retry_after, status: res.status }; }
      var next;
      try { next = C.recordAnalysis(app.state, mid, data, new Date()); }
      catch (e) { throw { code: 'bad_response', message: 'The server returned a response the app could not read. Nothing was saved. Please try again.' }; }
      commit(next, { noRender: true });
      toast('Analysis ready. Review the action items below.', 'success');
      app.selected[mid] = {};
    } catch (e) {
      var fe = friendly(e, e && e.status);
      app.errors[mid] = fe;
      commit(C.recordAnalysisFailure(app.state, mid, fe.message, new Date()), { noRender: true });
    } finally {
      clearTimeout(timer); delete app.analyzing[mid];
      if (app.route.id === mid) render();
    }
  }

  /* ================================================================== approval actions */
  function itemIdsFromSelection(mid) { var s = app.selected[mid] || {}; return Object.keys(s).filter(function (k) { return s[k]; }); }
  async function approve(mid, ids) {
    if (app.approving) return;
    app.approving = true;
    try {
      var m = meetingOf(mid); if (!m) return;
      var targets = ids === 'all' ? m.analysis.actionItems.filter(function (i) { return i.status === 'draft'; }).map(function (i) { return i.id; }) : ids;
      var blank = targets.filter(function (id) { var it = C.getItem(app.state, mid, id); return it && it.status === 'draft' && !it.title.trim(); });
      if (blank.length) { toast('Add a title to every action item before approving it.', 'error'); return; }
      var flagged = C.unresolvedFlagCount(m, targets);
      if (targets.length > 1 && flagged) {
        var ok = await confirmDialog({ title: 'Approve items that still have warnings?', message: plural(flagged, 'selected item') + ' still ' + (flagged === 1 ? 'has' : 'have') + ' unresolved review warnings (missing owner, unclear deadline or unverified evidence). Approve them anyway? You can edit them later on the board.', confirmLabel: 'Approve anyway' });
        if (!ok) return;
      }
      var res = C.approveActionItems(app.state, mid, targets, new Date());
      if (!res.created.length) { toast(res.skipped ? 'Those items were already handled — nothing new was created.' : 'Nothing to approve.', 'info'); return; }
      app.selected[mid] = {};
      commit(res.state);
      toast(plural(res.created.length, 'task') + ' added to the Kanban board (Open).', 'success');
    } finally { app.approving = false; }
  }

  function addItemModal(mid) {
    var owners = C.knownOwners(app.state, (meetingOf(mid) || {}).participants || []);
    openModal({
      title: 'Add action item',
      html: '<div class="field"><label for="n-title">Title</label><input type="text" id="n-title" maxlength="200" data-autofocus></div>' +
        '<div class="field"><label for="n-desc">Description</label><textarea id="n-desc" rows="2"></textarea></div>' +
        '<div class="field-row"><div class="field"><label for="n-owner">Owner</label><input type="text" id="n-owner" list="n-owners"><datalist id="n-owners">' + owners.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist></div>' +
        '<div class="field"><label for="n-due">Due date</label><input type="date" id="n-due"></div></div>' +
        '<div class="field"><label for="n-prio">Priority</label><select id="n-prio">' + opt('Medium', 'Medium', 'Medium') + opt('High', 'High', 'Medium') + opt('Low', 'Low', 'Medium') + '</select></div>' +
        '<div id="n-error" class="field-error" role="alert"></div><div class="modal-actions"><button class="btn" type="button" data-x="cancel">Cancel</button><button class="btn btn-primary" type="button" data-x="save">Add item</button></div>',
      onMount: function (h) {
        h.el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          if (b.dataset.x === 'cancel') return h.close(false);
          var title = $('#n-title', h.el).value.trim();
          if (!title) { $('#n-error', h.el).textContent = 'Enter a title for the action item.'; return; }
          var r = C.addManualActionItem(app.state, mid, { title: title, description: $('#n-desc', h.el).value, owner: $('#n-owner', h.el).value, dueDate: $('#n-due', h.el).value || null, priority: $('#n-prio', h.el).value }, new Date());
          h.close(true); commit(r.state); toast('Action item added as a draft.', 'success');
        });
      }
    });
  }

  /* ================================================================== data & backup */
  function downloadBackup() {
    var data = JSON.stringify(C.exportData(app.state, new Date()), null, 2);
    try {
      var blob = new Blob([data], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'meeting-tracker-backup-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Backup downloaded.', 'success');
    } catch (e) { toast('Could not create the download in this browser.', 'error'); }
  }
  function openDataModal() {
    var st = app.state;
    openModal({
      title: 'Data & backup',
      html: '<p class="privacy">Everything is stored only in this browser (localStorage). It is <strong>not</strong> shared with teammates or synced between devices, and clearing browser data deletes it. Export a backup regularly.</p>' +
        '<p class="muted small">Currently stored: ' + plural(st.tasks.length, 'task') + ', ' + plural(st.meetings.length, 'meeting') + '.</p>' +
        '<div class="modal-sec"><h3>Export</h3><p class="hint">Downloads all tasks, meetings, transcripts and analyses as a JSON file.</p><button class="btn btn-primary" type="button" data-x="export" style="margin-top:8px">Download backup</button></div>' +
        '<div class="modal-sec"><h3>Import</h3><p class="hint">Restores a backup exported from this app. The file is validated first, and your current data is saved as a safety copy before it is replaced.</p>' +
        '<label for="imp-file" class="sr-only">Backup file</label><input type="file" id="imp-file" accept=".json,application/json" style="margin-top:8px"><div id="imp-msg" class="field-error" role="alert"></div></div>' +
        '<div class="modal-sec"><h3>Clear everything</h3><p class="hint">Permanently deletes all tasks and meetings from this browser.</p><button class="btn btn-danger" type="button" data-x="clear" style="margin-top:8px">Clear all data…</button></div>' +
        '<div class="modal-actions"><button class="btn" type="button" data-x="close">Close</button></div>',
      onMount: function (h) {
        h.el.addEventListener('click', async function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          if (b.dataset.x === 'close') h.close(false);
          else if (b.dataset.x === 'export') downloadBackup();
          else if (b.dataset.x === 'clear') {
            var ok = await confirmDialog({ title: 'Delete all data?', message: 'This removes every task, meeting and analysis from this browser. Download a backup first if you might need them.', confirmLabel: 'Delete everything', danger: true });
            if (ok) { try { localStorage.setItem('meeting_tracker_pre_clear_backup', JSON.stringify(app.state)); } catch (e2) { /* ignore */ } h.close(true); app.selected = {}; commit(C.emptyState()); toast('All data cleared.'); }
          }
        });
        $('#imp-file', h.el).addEventListener('change', function (e) { importFile(e.target.files && e.target.files[0], h); });
      }
    });
  }
  function importFile(file, h) {
    var msg = $('#imp-msg', h.el); msg.textContent = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { msg.textContent = 'That file is too large to be a backup from this app.'; return; }
    var reader = new FileReader();
    reader.onerror = function () { msg.textContent = 'The file could not be read.'; };
    reader.onload = async function () {
      var res = C.parseImport(String(reader.result), new Date());
      if (!res.ok) { msg.textContent = res.errors.join(' '); return; }
      var ok = await confirmDialog({ title: 'Replace current data?', message: 'This backup contains ' + plural(res.counts.tasks, 'task') + ' and ' + plural(res.counts.meetings, 'meeting') + '. Your current data (' + plural(app.state.tasks.length, 'task') + ', ' + plural(app.state.meetings.length, 'meeting') + ') will be replaced, with a safety copy kept in this browser.' + (res.warnings.length ? ' Note: ' + res.warnings.join(' ') : ''), confirmLabel: 'Replace data', danger: true });
      if (!ok) return;
      try { localStorage.setItem('meeting_tracker_pre_import_backup', JSON.stringify(app.state)); } catch (e) { /* ignore */ }
      h.close(true); app.selected = {}; commit(res.state); toast('Backup imported.', 'success');
    };
    reader.readAsText(file);
  }

  /* ================================================================== demo */
  function loadDemo() {
    var d = Demo.buildDemoMeeting(new Date());
    var n = app.state.meetings.filter(function (m) { return m.isDemo; }).length;
    if (n) d.title += ' #' + (n + 1);
    var r = C.addMeeting(app.state, d, new Date());
    commit(r.state, { noRender: true });
    toast('Sample meeting loaded. Click “Analyze transcript” to continue.', 'success');
    go('#/meetings/' + r.meeting.id);
  }

  /* ================================================================== events */
  var main = $('#main');

  main.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-action]'); if (!el) { return; }
    var a = el.dataset.action, r = app.route, mid = r.id;
    switch (a) {
      case 'load-demo': return loadDemo();
      case 'dash-reset': app.dash = {}; return render();
      case 'k-clear': app.kFilters = {}; app.kSearch = ''; return render();
      case 'analyze': e.preventDefault(); return analyze();
      case 'analyze-demo': return analyze('demo');
      case 'save-meeting': {
        var f = readMeetingForm();
        if (r.id === 'new') {
          app.draft = f;
          var added = C.addMeeting(app.state, Object.assign({}, f, { title: f.title.trim() || 'Untitled meeting' }), new Date());
          app.draft = null; commit(added.state, { noRender: true }); toast('Meeting saved.', 'success'); return go('#/meetings/' + added.meeting.id);
        }
        saveMeetingForm(); toast('Changes saved.', 'success'); return render();
      }
      case 'delete-meeting': {
        var m = meetingOf(mid); if (!m) return;
        var n = C.tasksForMeeting(app.state, mid).length;
        var ok = await confirmDialog({ title: 'Delete this meeting?', message: '“' + m.title + '”, its transcript and analysis will be deleted.' + (n ? ' Its ' + plural(n, 'task') + ' will stay on the board but lose the link to this meeting.' : '') + ' This cannot be undone.', confirmLabel: 'Delete meeting', danger: true });
        if (ok) { commit(C.deleteMeeting(app.state, mid), { noRender: true }); toast('Meeting deleted.'); go('#/meetings'); }
        return;
      }
      case 'show-evidence': app.showEvidence = { meetingId: mid, excerpt: el.dataset.excerpt }; return render();
      case 'approve-item': return approve(mid, [el.dataset.item]);
      case 'approve-selected': return approve(mid, itemIdsFromSelection(mid));
      case 'approve-all': return approve(mid, 'all');
      case 'reject-selected': {
        var ids = itemIdsFromSelection(mid), s = app.state;
        ids.forEach(function (id) { s = C.rejectActionItem(s, mid, id, new Date()); });
        app.selected[mid] = {}; commit(s); return toast(plural(ids.length, 'item') + ' rejected.');
      }
      case 'reject-item': commit(C.rejectActionItem(app.state, mid, el.dataset.item, new Date())); return toast('Action item rejected. You can restore it.');
      case 'restore-item': return commit(C.restoreActionItem(app.state, mid, el.dataset.item, new Date()));
      case 'mark-reviewed': return commit(C.markReviewed(app.state, mid, el.dataset.item, new Date()));
      case 'delete-item': {
        var it = C.getItem(app.state, mid, el.dataset.item); if (!it) return;
        var yes = await confirmDialog({ title: 'Delete this action item?', message: '“' + it.title + '” will be removed from the list. Use Reject instead if you want to keep a record.', confirmLabel: 'Delete', danger: true });
        if (yes) commit(C.deleteActionItem(app.state, mid, it.id));
        return;
      }
      case 'add-item': return addItemModal(mid);
      /* kanban */
      case 'toggle-menu': e.stopPropagation(); app.openMenu = app.openMenu === el.dataset.task ? null : el.dataset.task; render(); var mb = $('.dropdown .drop-btn'); return mb && mb.focus();
      case 'edit-task': app.openMenu = null; render(); return openTaskModal(el.dataset.task);
      case 'move-task': app.openMenu = null; commit(C.moveTask(app.state, el.dataset.task, el.dataset.col, new Date())); return toast('Moved to ' + C.columnLabel(el.dataset.col) + '.');
      case 'delete-task': {
        var t = app.state.tasks.filter(function (x) { return x.id === el.dataset.task; })[0]; app.openMenu = null; render(); if (!t) return;
        var d = await confirmDialog({ title: 'Delete this task?', message: '“' + t.title + '” will be removed from the board. This cannot be undone.', confirmLabel: 'Delete task', danger: true });
        if (d) commit(C.deleteTask(app.state, t.id, new Date()));
        return;
      }
      case 'add-card': { app.addingTo = el.dataset.col; render(); var qt = $('#q-title'); if (qt) qt.focus(); return; }
      case 'q-cancel': app.addingTo = null; return render();
      case 'q-prio': {
        $$('#q-prio .prio-btn').forEach(function (b) { var on = b === el; b.setAttribute('aria-pressed', on); b.className = 'prio-btn' + (on ? ' sel-' + b.dataset.p : ''); });
        return;
      }
      case 'q-save': return quickAdd(el.dataset.col);
    }
  });

  function quickAdd(col) {
    var title = ($('#q-title') || {}).value || '';
    if (!title.trim()) { $('#q-title').focus(); return toast('Enter a card title.', 'error'); }
    var pressed = $('#q-prio [aria-pressed="true"]');
    var res = C.addTask(app.state, { title: title, priority: pressed ? pressed.dataset.p : 'Medium', assignee: $('#q-assignee').value, dueDate: $('#q-due').value || null, column: col }, new Date());
    app.addingTo = null; commit(res.state);
  }
  main.addEventListener('keydown', function (e) {
    if (e.target.id === 'q-title') {
      if (e.key === 'Enter') { e.preventDefault(); quickAdd(e.target.closest('[data-qform]').dataset.qform); }
      if (e.key === 'Escape') { app.addingTo = null; render(); }
    }
  });

  main.addEventListener('change', function (e) {
    var el = e.target, kind = el.dataset.change; if (!kind) return;
    switch (kind) {
      case 'dash-filter': if (el.value) app.dash[el.dataset.key] = el.value; else delete app.dash[el.dataset.key]; return render();
      case 'k-filter': if (el.value) app.kFilters[el.dataset.key] = el.value; else delete app.kFilters[el.dataset.key]; return render();
      case 'mode': app.formMode = el.value; return;
      case 'meeting-field': {
        saveMeetingForm();
        if (el.dataset.field === 'title' && app.route.id !== 'new') { var h1 = $('h1'); if (h1) h1.textContent = el.value.trim() || 'Untitled meeting'; }
        return;
      }
      case 'upload': return handleUpload(el);
      case 'item-field': {
        var mid = app.route.id, patch = {}; patch[el.dataset.field] = el.value;
        commit(C.updateActionItem(app.state, mid, el.dataset.item, patch, new Date()), { noRender: true });
        var article = el.closest('.item'), badge = $('.badge.danger', article);
        if (article) { $$('.badge.danger', article).forEach(function (b) { if (b.textContent === 'Needs review') { b.className = 'badge ok'; b.textContent = 'Reviewed'; } }); var rs = $('.reasons', article); if (rs) rs.remove(); var mr = $('[data-action="mark-reviewed"]', article); if (mr) mr.remove(); }
        return;
      }
      case 'select-item': {
        var sm = app.route.id, sel = app.selected[sm] || (app.selected[sm] = {});
        if (el.checked) sel[el.dataset.item] = true; else delete sel[el.dataset.item];
        return refreshBulk(sm);
      }
      case 'select-all': {
        var mm = meetingOf(app.route.id), s2 = app.selected[mm.id] = {};
        mm.analysis.actionItems.forEach(function (i) { if (i.status === 'draft' && el.checked) s2[i.id] = true; });
        $$('[data-change="select-item"]').forEach(function (c) { c.checked = !!el.checked; });
        return refreshBulk(mm.id);
      }
    }
  });
  function refreshBulk(mid) {
    var n = itemIdsFromSelection(mid).length, c = $('#sel-count');
    if (c) c.textContent = n + ' selected';
    ['btn-approve-sel', 'btn-reject-sel'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = n === 0; });
    var m = meetingOf(mid), drafts = m && m.analysis ? m.analysis.actionItems.filter(function (i) { return i.status === 'draft'; }).length : 0;
    var all = $('#sel-all'); if (all) all.checked = drafts > 0 && n === drafts;
  }
  main.addEventListener('input', function (e) {
    var el = e.target, kind = el.dataset.input;
    if (kind === 'm-search') { app.mSearch = el.value; render(); }
    else if (kind === 'k-search') { app.kSearch = el.value; render(); }
    else if (kind === 'count') { var c = $('#mt-count'); if (c) c.textContent = el.value.length.toLocaleString('en-US'); if (app.formError) { app.formError = null; var er = $('#mt-error'); if (er) er.remove(); } }
  });

  function handleUpload(input) {
    var file = input.files && input.files[0]; if (!file) return;
    var v = C.validateUpload(file);
    if (!v.ok) { input.value = ''; app.formError = v.error; return render(); }
    var reader = new FileReader();
    reader.onerror = function () { app.formError = 'The file could not be read. Try pasting the text instead.'; render(); };
    reader.onload = function () {
      var text = String(reader.result || '');
      if (!C.looksLikeText(text)) { app.formError = 'That file does not look like plain text. Upload a .txt transcript or paste the text.'; return render(); }
      var form = readMeetingForm(); form.transcript = text;
      if (!form.title && file.name) form.title = file.name.replace(/\.txt$/i, '');
      if (app.route.id === 'new') app.draft = form; else commit(C.updateMeeting(app.state, app.route.id, form, new Date()), { noRender: true });
      app.formError = null; render(); toast('Loaded ' + file.name + '.', 'success');
    };
    reader.readAsText(file);
  }

  /* ---- drag and drop (mouse); keyboard users move cards via the ··· menu */
  main.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.kcard'); if (!card) return;
    app.dragId = card.dataset.taskId;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', app.dragId); } catch (err) { /* ignore */ }
    setTimeout(function () { card.classList.add('dragging'); }, 0);
  });
  main.addEventListener('dragend', function (e) { app.dragId = null; $$('.kcard.dragging').forEach(function (c) { c.classList.remove('dragging'); }); $$('.col.over').forEach(function (c) { c.classList.remove('over'); }); });
  main.addEventListener('dragover', function (e) { var col = e.target.closest && e.target.closest('.col'); if (col && app.dragId) { e.preventDefault(); col.classList.add('over'); } });
  main.addEventListener('dragleave', function (e) { var col = e.target.closest && e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  main.addEventListener('drop', function (e) {
    var col = e.target.closest && e.target.closest('.col'); if (!col || !app.dragId) return;
    e.preventDefault(); col.classList.remove('over');
    var id = app.dragId; app.dragId = null;
    var t = app.state.tasks.filter(function (x) { return x.id === id; })[0];
    if (t && t.column !== col.dataset.col) { commit(C.moveTask(app.state, id, col.dataset.col, new Date())); }
    else render();
  });

  document.addEventListener('click', function (e) { if (app.openMenu && !e.target.closest('.menu-wrap')) { app.openMenu = null; if (app.route.name === 'kanban') render(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && app.openMenu) { app.openMenu = null; render(); } });
  $('#btn-data').addEventListener('click', openDataModal);
  $('#footer-backup').addEventListener('click', openDataModal);
  window.addEventListener('hashchange', onHashChange);

  /* ================================================================== server health */
  async function checkHealth() {
    var badge = $('#mode-badge');
    try {
      var res = await fetch('/api/health'), h = await res.json();
      if (!res.ok || h.status !== 'ok') throw new Error('bad');
      app.health = h;
      if (h.ai_configured) { badge.textContent = 'Live AI · ' + h.provider_label + ' · ' + h.model; badge.className = 'mode-badge live'; }
      else { badge.textContent = 'Demo mode (no AI key)'; badge.className = 'mode-badge demo'; }
    } catch (e) {
      app.health = null; badge.textContent = 'Analysis server offline'; badge.className = 'mode-badge offline';
    }
    if (app.route.name === 'meeting' && !Object.keys(app.analyzing).length) { saveMeetingForm(); render(); }
  }

  /* ================================================================== boot */
  loadState();
  app.route = parseHash(); app.routeChanged = true;
  render();
  checkHealth();
})();

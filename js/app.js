/*
 * 화면 — 해시 주소로 나눕니다.
 *   #/status          현황(기종 × 공통 단계 표 / 간트형), 임박·지연 강조
 *   #/models          기종 관리(추가·수정·삭제, 자료 저장소 링크)
 *   #/model/<id>      기종 상세(단계별 일정 수정, 이슈·자료 요약)
 *   #/issues[/<id>]   이슈 관리함(전체 또는 한 기종)
 *   #/docs[/<id>]     자료 목록(전체 또는 한 기종)
 *   #/import          일정 Excel 가져오기(열 이름 매핑)
 *   #/bm[/<id>]       과제 A · Bench Marking(시장·브랜드·공개 자료·프롬프트·리포트)
 *   #/settings        공통 개발 단계·임박 기준일
 *   #/data            예시 데이터·엑셀 내보내기/가져오기·초기화
 */
(function () {
  'use strict';
  var L = window.DQLogic, S = window.DQStore, Sample = window.DQSample;
  var db = S.loadDb();
  var main = document.getElementById('main');
  var boardFilter = { owner: '', attentionOnly: false, view: 'table' };
  var issueFilter = { stageId: '', status: '미종결', overdueOnly: false, q: '' };
  var importState = null;

  // ── 도우미 ────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function today() { return L.ymd(new Date()); }
  function soonDays() { var n = parseInt(db.settings.soonDays, 10); return n >= 0 ? n : 7; }
  function save() {
    if (!S.saveDb(db)) document.getElementById('storageBanner').hidden = false;
    banner();
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function modelById(id) { var i = L.indexById(db.models, id); return i >= 0 ? db.models[i] : null; }
  function stageName(id) { var i = L.indexById(db.stages, id); return i >= 0 ? db.stages[i].name : ''; }
  function badge(status) { return h('span', { class: 'badge s-' + status.replace(/\s/g, '') }, status); }
  function issueBadge(status) { return h('span', { class: 'badge i-' + status }, status); }

  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  // 대화상자: buttons = [{label, primary, danger, onClick}] — onClick 이 false 를 돌려주면 닫지 않습니다.
  function dialog(title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var box = document.getElementById('dialogContent');
    box.textContent = '';
    append(box, content);
    var acts = document.getElementById('dialogActions');
    acts.textContent = '';
    (buttons || [{ label: '닫기' }]).forEach(function (b) {
      acts.appendChild(h('button', {
        type: 'button', class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''),
        onclick: function () { var keep = b.onClick ? b.onClick() === false : false; if (!keep && dlg.open) dlg.close(); }
      }, b.label));
    });
    if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
    return dlg;
  }
  function confirmBox(title, msg, okLabel, onOk) {
    dialog(title, h('p', null, msg), [{ label: '취소' }, { label: okLabel, danger: true, onClick: onOk }]);
  }
  function copyText(text, done) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
      document.body.removeChild(ta);
      toast(done || '복사했습니다.');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(done || '복사했습니다.'); }, fallback);
    else fallback();
  }
  function isWebLink(s) { return /^https?:\/\//i.test(s || ''); }
  // 링크: 웹 주소면 새 창, 사내 공유 폴더 경로면 복사(브라우저는 파일 탐색기 경로를 직접 열지 못함)
  function linkButton(link, label) {
    if (!link) return null;
    if (isWebLink(link)) return h('a', { class: 'btn btn-sm', href: link, target: '_blank', rel: 'noopener' }, label || '열기');
    return h('button', { type: 'button', class: 'btn btn-sm', title: link,
      onclick: function () { copyText(link, '경로를 복사했습니다. 파일 탐색기 주소창에 붙여 넣으십시오.'); } }, (label || '경로') + ' 복사');
  }
  function field(label, input, note) {
    return h('label', { class: 'field' }, h('span', null, label), input, note ? h('small', { class: 'note' }, note) : null);
  }
  function input(name, value, attrs) { return h('input', Object.assign({ name: name, value: value == null ? '' : value, type: 'text' }, attrs || {})); }
  function select(name, options, value, attrs) {
    // options: [[value, label]]
    return h('select', Object.assign({ name: name }, attrs || {}), options.map(function (o) {
      var el = h('option', { value: o[0] }, o[1]);
      if (String(o[0]) === String(value == null ? '' : value)) el.selected = true;
      return el;
    }));
  }
  function modelOptions(blankLabel) {
    var list = db.models.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).map(function (m) { return [m.id, m.name]; });
    return blankLabel ? [['', blankLabel]].concat(list) : list;
  }
  function stageOptions(blankLabel) {
    return [['', blankLabel || '(단계 없음)']].concat(L.sortedStages(db).map(function (s) { return [s.id, s.name]; }));
  }
  function val(root, name) { var el = root.querySelector('[name="' + name + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; }
  function tableWrap(table) { return h('div', { class: 'table-wrap' }, table); }
  function fileNameStamp() { return (db._sample ? '예시데이터_' : '') + today().replace(/-/g, ''); }
  function writeBook(sheets, name) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n); });
    XLSX.writeFile(wb, name);
  }
  // 파일 선택 → 파일명만 받습니다(파일 자체는 저장하지 않음)
  function filePicker(onNames, multiple) {
    return h('input', { type: 'file', multiple: multiple ? true : null, 'aria-label': '파일 선택(파일명만 기록)',
      onchange: function (e) { var names = Array.prototype.map.call(e.target.files, function (f) { return f.name; }); onNames(names); e.target.value = ''; } });
  }

  function banner() {
    var b = document.getElementById('sampleBanner');
    b.textContent = '';
    if (db._sample) {
      append(b, ['예시 데이터(가상)를 보고 있습니다. 실제 기종·일정·브랜드·스펙이 아닙니다.',
        h('button', { type: 'button', class: 'btn btn-sm', onclick: function () {
          confirmBox('예시 데이터 지우기', '예시 데이터를 모두 지우고 빈 상태로 시작합니다.', '지우기', function () { resetDb(); toast('예시 데이터를 지웠습니다.'); go('#/status'); });
        } }, '지우고 새로 시작')]);
      b.hidden = false;
    } else b.hidden = true;
  }
  function resetDb() { db = L.emptyDb(); S.clearDb(); save(); }
  function loadSample() { db = Sample.build(new Date(), L); save(); }

  // ── 메뉴 ─────────────────────────────────────────────────
  var MENU = [['#/status', '현황'], ['#/models', '기종'], ['#/issues', '이슈 관리함'], ['#/docs', '자료'],
    ['#/import', '일정 가져오기'], ['#/bm', 'Bench Marking'], ['#/settings', '설정'], ['#/data', '데이터']];
  function renderNav(route) {
    var nav = document.getElementById('nav');
    nav.textContent = '';
    var base = '#/' + (route.split('/')[1] || 'status');
    if (base === '#/model') base = '#/models';
    MENU.forEach(function (m) { nav.appendChild(h('a', { href: m[0], 'aria-current': m[0] === base ? 'page' : null }, m[1])); });
  }

  // ── 현황 ─────────────────────────────────────────────────
  function viewStatus() {
    var t = today(), soon = soonDays();
    var head = h('div', { class: 'page-head' }, h('h1', null, '개발 기종 현황'),
      h('span', { class: 'note' }, '오늘 ' + t + ' · 임박 기준 ' + soon + '일(설정에서 변경)'));
    if (!db.models.length) {
      return [head, h('div', { class: 'card empty-state' },
        h('p', null, '아직 등록된 기종이 없습니다.'),
        h('p', { class: 'note' }, '개발 기종 일정 Excel을 가져오거나, 기종을 직접 추가하십시오. 먼저 둘러보려면 예시 데이터를 불러오십시오.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { loadSample(); toast('예시 데이터를 불러왔습니다.'); render(); } }, '예시 데이터 불러오기'),
          h('a', { class: 'btn', href: '#/import' }, '일정 Excel 가져오기'),
          h('a', { class: 'btn', href: '#/models' }, '기종 직접 추가')))];
    }
    var sm = L.summary(db, t, soon);
    var stats = h('div', { class: 'stats' },
      stat(sm.models, '기종'), stat(sm.late, '지연 일정', 'warn'), stat(sm.soon, '임박 일정', 'soon'),
      stat(sm.openIssues, '미종결 이슈'), stat(sm.overdueIssues, '기한 지난 이슈', 'warn'), stat(sm.docs, '등록 자료'));
    var filters = h('div', { class: 'card' }, h('div', { class: 'filters' },
      field('담당자', input('owner', boardFilter.owner, { placeholder: '이름 일부' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'attention', checked: boardFilter.attentionOnly }), '지연·임박·기한 지난 이슈가 있는 기종만'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', 'aria-pressed': String(boardFilter.view === 'table'), onclick: function () { boardFilter.view = 'table'; render(); } }, '단계표'),
        h('button', { type: 'button', class: 'btn', 'aria-pressed': String(boardFilter.view === 'gantt'), onclick: function () { boardFilter.view = 'gantt'; render(); } }, '간트형'))));
    filters.querySelector('[name=owner]').addEventListener('input', function (e) { boardFilter.owner = e.target.value; redrawBoard(); });
    filters.querySelector('[name=attention]').addEventListener('change', function (e) { boardFilter.attentionOnly = e.target.checked; redrawBoard(); });
    var boardBox = h('div', { id: 'boardBox' });
    function redrawBoard() {
      boardBox.textContent = '';
      var b = L.statusBoard(db, t, soon, boardFilter);
      append(boardBox, h('div', { class: 'list-meta' }, h('span', null, '기종 ' + b.rows.length + '개'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: exportBoard }, '현황 엑셀 내보내기')));
      append(boardBox, legend());
      if (!b.stages.length) { append(boardBox, h('div', { class: 'alert info' }, '공통 개발 단계가 없습니다. 「설정」에서 단계를 정하거나 일정 Excel을 가져오십시오.')); return; }
      append(boardBox, boardFilter.view === 'gantt' ? ganttView(b.rows.map(function (r) { return r.model; }), t, soon) : boardTable(b));
    }
    redrawBoard();
    return [head, stats, filters, boardBox];
  }
  function stat(n, label, cls) { return h('div', { class: 'stat' + (cls && n ? ' ' + cls : '') }, h('b', null, String(n)), h('span', null, label)); }
  function legend() {
    var S2 = L.SCHED_STATUS;
    return h('div', { class: 'legend' }, h('span', { class: 'note' }, '상태:'),
      [S2.LATE, S2.SOON, S2.DOING, S2.PLANNED, S2.DONE, S2.NODATE].map(badge));
  }
  function boardTable(b) {
    var thead = h('thead', null, h('tr', null, h('th', null, '기종'), b.stages.map(function (s) { return h('th', null, s.name); })));
    var tbody = h('tbody', null, b.rows.map(function (r) {
      var m = r.model;
      return h('tr', null,
        h('th', { class: 'model-col', scope: 'row' },
          h('a', { href: '#/model/' + m.id }, m.name),
          m.owner ? h('span', { class: 'cell-owner note' }, m.owner) : null,
          h('div', { class: 'model-actions' },
            h('a', { class: 'btn btn-sm', href: '#/issues/' + m.id },
              '이슈 관리함 ' + r.openIssues + (r.overdueIssues ? ' (기한 지남 ' + r.overdueIssues + ')' : '')),
            linkButton(m.repoLink, '저장소'))),
        r.cells.map(function (c) {
          var s = c.schedule;
          var td = h('td', { class: 'cell' + (s ? '' : ' empty'), tabindex: '0', title: '눌러서 일정 수정',
            onclick: function () { editScheduleDialog(m, c.stage); },
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editScheduleDialog(m, c.stage); } } },
            s ? [badge(c.status), h('span', { class: 'cell-dates' }, (s.start || '?') + ' ~ ' + (s.end || '?')), s.owner ? h('span', { class: 'cell-owner' }, s.owner) : null] : '—');
          return td;
        }));
    }));
    return tableWrap(h('table', { class: 'board' }, thead, tbody));
  }
  function ganttView(models, t, soon) {
    var all = db.schedules.filter(function (s) { return models.some(function (m) { return m.id === s.modelId; }); });
    var g = L.ganttLayout(all, t);
    if (!g.bars.length) return h('div', { class: 'alert info' }, '날짜가 들어간 일정이 없습니다.');
    var wrap = h('div', { class: 'gantt' });
    wrap.appendChild(h('div', { class: 'gantt-head' }, h('div', null, '기종'),
      h('div', { class: 'gantt-scale' }, h('span', null, g.min), h('span', null, g.max))));
    models.forEach(function (m) {
      var track = h('div', { class: 'gantt-track' });
      g.bars.forEach(function (b) {
        if (b.schedule.modelId !== m.id) return;
        var st = L.scheduleStatus(b.schedule, t, soon), name = stageName(b.schedule.stageId);
        track.appendChild(h('button', { type: 'button', class: 'gantt-bar s-' + st.replace(/\s/g, ''),
          style: 'left:' + b.leftPct.toFixed(3) + '%;width:' + b.widthPct.toFixed(3) + '%',
          title: name + ' ' + (b.schedule.start || '?') + ' ~ ' + (b.schedule.end || '?') + ' (' + st + ')',
          'aria-label': m.name + ' ' + name + ' ' + st,
          onclick: function () { var i = L.indexById(db.stages, b.schedule.stageId); editScheduleDialog(m, db.stages[i]); } }, name));
      });
      if (g.todayPct != null) track.appendChild(h('div', { class: 'gantt-today', style: 'left:' + g.todayPct.toFixed(3) + '%', title: '오늘' }));
      wrap.appendChild(h('div', { class: 'gantt-row' }, h('div', { class: 'gantt-label' }, h('a', { href: '#/model/' + m.id }, m.name)), track));
    });
    return h('div', null, h('div', { class: 'table-wrap' }, wrap), h('p', { class: 'note' }, '빨간 세로선이 오늘입니다. 막대를 누르면 일정을 고칩니다.'));
  }
  function editScheduleDialog(m, stage) {
    var s = L.findSchedule(db, m.id, stage.id) || {};
    var form = h('div', { class: 'form-grid' },
      field('시작일', input('start', s.start, { type: 'date' })),
      field('종료일', input('end', s.end, { type: 'date' })),
      field('담당자', input('owner', s.owner)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'done', checked: s.done }), '완료'),
      h('div', { class: 'span-all' }, field('메모', input('memo', s.memo))),
      h('p', { class: 'note span-all' }, '모든 칸을 비우고 저장하면 이 단계 일정이 지워집니다.'),
      h('div', { class: 'err span-all', id: 'dlgErr', role: 'alert' }));
    dialog(m.name + ' · ' + stage.name + ' 일정', form, [{ label: '취소' }, { label: '저장', primary: true, onClick: function () {
      var r = L.saveSchedule(db, m.id, stage.id, { start: val(form, 'start'), end: val(form, 'end'), owner: val(form, 'owner'), done: val(form, 'done'), memo: val(form, 'memo') });
      if (r.error) { form.querySelector('#dlgErr').textContent = r.error; return false; }
      save(); toast('일정을 저장했습니다.'); render();
    } }]);
  }
  function exportBoard() {
    var sheets = { '현황표': L.boardSheet(db, today(), soonDays()) };
    var all = L.dbToSheets(db, today());
    sheets['일정'] = all['일정']; sheets['이슈'] = all['이슈'];
    writeBook(sheets, '선행품질_현황_' + fileNameStamp() + '.xlsx');
  }

  // ── 기종 관리 ─────────────────────────────────────────────
  function viewModels() {
    var head = h('div', { class: 'page-head' }, h('h1', null, '기종 관리'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { editModelDialog(null); } }, '기종 추가'));
    if (!db.models.length) return [head, h('div', { class: 'card' }, h('p', null, '등록된 기종이 없습니다. 「기종 추가」를 누르거나 「일정 가져오기」로 일정 Excel을 올리십시오.'))];
    var rows = db.models.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).map(function (m) {
      var u = L.modelUsage(db, m.id);
      return h('tr', null,
        h('td', null, h('a', { href: '#/model/' + m.id }, m.name)),
        h('td', null, m.owner),
        h('td', null, m.repoLink ? h('div', { class: 'link-box' }, h('code', null, m.repoLink), linkButton(m.repoLink, '저장소')) : h('span', { class: 'note' }, '미입력')),
        h('td', { class: 'nowrap' }, '일정 ' + u.schedules + ' · 이슈 ' + u.issues + ' · 자료 ' + u.docs),
        h('td', null, h('div', { class: 'row-actions' },
          h('a', { class: 'btn btn-sm', href: '#/issues/' + m.id }, '이슈 관리함'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { editModelDialog(m); } }, '수정'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () { deleteModelConfirm(m); } }, '삭제'))));
    });
    return [head, tableWrap(h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['기종', '담당자', '자료 저장소 링크', '등록 건수', ''].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, rows)))];
  }
  function editModelDialog(m) {
    var form = h('div', { class: 'form-grid' },
      field('기종명', input('name', m && m.name, { required: true })),
      field('담당자', input('owner', m && m.owner)),
      h('div', { class: 'span-all' }, field('자료 저장소 링크', input('repoLink', m && m.repoLink, { placeholder: '예: \\\\공유서버\\선행품질\\기종명 또는 https://…' }),
        '사내 공유 폴더 경로나 SharePoint·Teams 주소를 적습니다. 파일 자체는 이 도구에 저장하지 않습니다.')),
      h('div', { class: 'span-all' }, field('메모', input('memo', m && m.memo))),
      h('div', { class: 'err span-all', id: 'dlgErr', role: 'alert' }));
    dialog(m ? '기종 수정' : '기종 추가', form, [{ label: '취소' }, { label: '저장', primary: true, onClick: function () {
      var r = L.saveModel(db, { id: m && m.id, name: val(form, 'name'), owner: val(form, 'owner'), repoLink: val(form, 'repoLink'), memo: val(form, 'memo') });
      if (r.error) { form.querySelector('#dlgErr').textContent = r.error; return false; }
      save(); toast('기종을 저장했습니다.'); render();
    } }]);
  }
  function deleteModelConfirm(m) {
    var u = L.modelUsage(db, m.id);
    confirmBox('기종 삭제', '「' + m.name + '」과 딸린 일정 ' + u.schedules + '건, 이슈 ' + u.issues + '건, 자료 ' + u.docs + '건을 함께 지웁니다. 되돌릴 수 없으니 먼저 「데이터」에서 엑셀로 내보내 두십시오.', '삭제', function () {
      L.deleteModel(db, m.id); save(); toast('삭제했습니다.'); go('#/models');
    });
  }

  // ── 기종 상세 ─────────────────────────────────────────────
  function viewModel(id) {
    var m = modelById(id);
    if (!m) return h('div', { class: 'card' }, h('p', null, '기종을 찾을 수 없습니다.'), h('a', { href: '#/models' }, '기종 목록으로'));
    var t = today(), soon = soonDays();
    var u = L.modelUsage(db, m.id);
    var head = h('div', { class: 'page-head' }, h('h1', null, m.name),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary', href: '#/issues/' + m.id }, '이슈 관리함 (' + u.issues + ')'),
        h('a', { class: 'btn', href: '#/docs/' + m.id }, '자료 목록 (' + u.docs + ')'),
        h('button', { type: 'button', class: 'btn', onclick: function () { editModelDialog(m); } }, '기종 정보 수정')));
    var info = h('div', { class: 'card' }, h('dl', { class: 'detail-head' },
      kv('담당자', m.owner || '—'), kv('자료 저장소 링크', m.repoLink ? h('div', { class: 'link-box' }, h('code', null, m.repoLink), linkButton(m.repoLink, '저장소')) : '미입력'),
      kv('메모', m.memo || '—')));
    var stages = L.sortedStages(db);
    var sched;
    if (!stages.length) sched = h('div', { class: 'alert info' }, '공통 개발 단계가 없습니다. 「설정」에서 먼저 정하십시오.');
    else {
      var rows = stages.map(function (st) {
        var s = L.findSchedule(db, m.id, st.id) || {};
        var status = s.id ? L.scheduleStatus(s, t, soon) : '';
        return h('tr', { 'data-stage': st.id },
          h('th', { scope: 'row' }, st.name), h('td', null, status ? badge(status) : '—'),
          h('td', null, h('input', { type: 'date', name: 'start', value: s.start || '', 'aria-label': st.name + ' 시작일' })),
          h('td', null, h('input', { type: 'date', name: 'end', value: s.end || '', 'aria-label': st.name + ' 종료일' })),
          h('td', null, h('input', { type: 'text', name: 'owner', value: s.owner || '', 'aria-label': st.name + ' 담당자' })),
          h('td', null, h('input', { type: 'checkbox', name: 'done', checked: s.done, 'aria-label': st.name + ' 완료' })),
          h('td', null, h('input', { type: 'text', name: 'memo', value: s.memo || '', 'aria-label': st.name + ' 메모' })));
      });
      var tbl = h('table', { class: 'list sched-edit' },
        h('thead', null, h('tr', null, ['단계', '상태', '시작일', '종료일', '담당자', '완료', '메모'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, rows));
      var err = h('div', { class: 'alert warn', hidden: true, role: 'alert' });
      sched = h('div', null, tableWrap(tbl), err, h('div', { class: 'submit-bar' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var bad = [];
          Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function (tr) {
            var r = L.saveSchedule(db, m.id, tr.getAttribute('data-stage'), { start: val(tr, 'start'), end: val(tr, 'end'), owner: val(tr, 'owner'), done: val(tr, 'done'), memo: val(tr, 'memo') });
            if (r.error) bad.push(stageName(tr.getAttribute('data-stage')) + ': ' + r.error);
          });
          save();
          if (bad.length) { render(); toast('일부 단계를 저장하지 못했습니다.', true); var e2 = main.querySelector('.alert.warn'); if (e2) { e2.hidden = false; e2.textContent = bad.join(' / '); } }
          else { toast('단계별 일정을 저장했습니다.'); render(); }
        } }, '일정 저장')));
    }
    var mine = db.schedules.filter(function (s) { return s.modelId === m.id; });
    var issues = L.filterIssues(db, { modelId: m.id, status: '미종결' }, t).slice(0, 5);
    return [head, info,
      h('div', { class: 'card' }, h('h2', null, '단계별 일정'), h('p', { class: 'note' }, '상세 일정은 기종 담당자가 여기서 고칩니다. 일정 Excel을 다시 가져와도 완료 표시와 메모는 남습니다.'), sched),
      h('div', { class: 'card' }, h('h2', null, '간트형 보기'), mine.length ? ganttView([m], t, soon) : h('p', { class: 'note' }, '날짜가 들어간 일정이 없습니다.')),
      h('div', { class: 'card' }, h('h2', null, '미종결 이슈'), issues.length ? issueTable(issues, false) : h('p', { class: 'note' }, '미종결 이슈가 없습니다.'),
        h('a', { class: 'btn', href: '#/issues/' + m.id }, '이슈 관리함 열기'))];
  }
  function kv(k, v) { return h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v)); }

  // ── 이슈 관리함 ───────────────────────────────────────────
  function viewIssues(modelId) {
    var m = modelId ? modelById(modelId) : null;
    if (modelId && !m) return h('div', { class: 'card' }, h('p', null, '기종을 찾을 수 없습니다.'));
    var t = today();
    var head = h('div', { class: 'page-head' }, h('h1', null, m ? m.name + ' · 이슈 관리함' : '이슈 관리함 (전체 기종)'),
      h('div', { class: 'btn-row' },
        m ? linkButton(m.repoLink, '저장소') : null,
        h('button', { type: 'button', class: 'btn btn-primary', disabled: db.models.length ? null : true, onclick: function () { editIssueDialog(null, modelId); } }, '이슈 등록')));
    var picker = h('div', { class: 'card' }, h('div', { class: 'filters' },
      field('기종', select('model', modelOptions('전체 기종'), modelId || '')),
      field('단계', select('stage', stageOptions('전체 단계'), issueFilter.stageId)),
      field('상태', select('status', [['미종결', '미종결(열림+조치중)'], ['', '전체']].concat(L.ISSUE_STATUS.map(function (s) { return [s, s]; })), issueFilter.status)),
      field('검색', input('q', issueFilter.q, { placeholder: '제목·내용·담당자·번호' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'overdue', checked: issueFilter.overdueOnly }), '기한 지난 것만')));
    picker.querySelector('[name=model]').addEventListener('change', function (e) { go(e.target.value ? '#/issues/' + e.target.value : '#/issues'); });
    var listBox = h('div');
    function redraw() {
      issueFilter.stageId = val(picker, 'stage'); issueFilter.status = val(picker, 'status');
      issueFilter.q = val(picker, 'q'); issueFilter.overdueOnly = val(picker, 'overdue');
      var list = L.filterIssues(db, Object.assign({ modelId: modelId || '' }, issueFilter), t);
      listBox.textContent = '';
      append(listBox, h('div', { class: 'list-meta' }, h('span', null, list.length + '건'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: function () {
          var sh = L.dbToSheets(db, t)['이슈'];
          var keep = {}; list.forEach(function (x) { keep[x.no] = true; });
          writeBook({ '이슈': [sh[0]].concat(sh.slice(1).filter(function (r) { return keep[r[0]]; })) }, '이슈목록_' + fileNameStamp() + '.xlsx');
        } }, '이 목록 엑셀 내보내기')));
      append(listBox, list.length ? issueTable(list, !modelId) : h('div', { class: 'card' }, h('p', null, db.issues.length ? '조건에 맞는 이슈가 없습니다.' : '등록된 이슈가 없습니다.')));
    }
    ['stage', 'status', 'overdue'].forEach(function (n) { picker.querySelector('[name=' + n + ']').addEventListener('change', redraw); });
    picker.querySelector('[name=q]').addEventListener('input', redraw);
    redraw();
    return [head, h('p', { class: 'note' }, '기종별 모든 이슈를 모아 봅니다. Outlook MSG 등 근거 자료는 파일명과 저장 위치(링크)로 붙입니다.'), picker, listBox];
  }
  function issueTable(list, showModel) {
    var t = today();
    var cols = ['번호', '상태'].concat(showModel ? ['기종'] : []).concat(['단계', '제목', '담당자', '기한', '근거']);
    return tableWrap(h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', null, c); }))),
      h('tbody', null, list.map(function (x) {
        var m = modelById(x.modelId);
        var over = L.issueOverdue(x, t);
        return h('tr', { tabindex: '0', title: '눌러서 수정',
          onclick: function () { editIssueDialog(x, x.modelId); },
          onkeydown: function (e) { if (e.key === 'Enter') editIssueDialog(x, x.modelId); } },
          h('td', { class: 'nowrap' }, x.no), h('td', null, issueBadge(x.status), over ? [' ', h('span', { class: 'badge over' }, '기한 지남')] : null),
          showModel ? h('td', null, m ? m.name : '') : null,
          h('td', null, stageName(x.stageId)), h('td', { class: 'clip' }, h('div', { class: 'clip-text' }, x.title)),
          h('td', null, x.owner), h('td', { class: 'nowrap' }, x.due || '—'),
          h('td', null, x.evidence.length ? x.evidence.length + '건' : '—'));
      }))));
  }
  function editIssueDialog(x, modelId) {
    var cur = x || { modelId: modelId || (db.models[0] && db.models[0].id), status: '열림', evidence: [] };
    var evidence = cur.evidence.slice();
    var evBox = h('ul', { class: 'evidence' });
    function drawEv() {
      evBox.textContent = '';
      evidence.forEach(function (e, i) {
        evBox.appendChild(h('li', null, e.name, e.link ? [' · ', h('code', null, e.link), ' ', linkButton(e.link, '위치')] : null, ' ',
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { evidence.splice(i, 1); drawEv(); } }, '빼기')));
      });
      if (!evidence.length) evBox.appendChild(h('li', { class: 'note' }, '붙인 근거가 없습니다.'));
    }
    drawEv();
    var evLink = input('evLink', '', { placeholder: '저장 위치(공유 폴더 경로·주소) — 선택' });
    var evName = input('evName', '', { placeholder: '파일명 예: 회의록_0928.msg' });
    var form = h('div', { class: 'form-grid' },
      field('기종', select('modelId', modelOptions(), cur.modelId)),
      field('개발 단계', select('stageId', stageOptions(), cur.stageId)),
      h('div', { class: 'span-all' }, field('제목', input('title', cur.title))),
      h('div', { class: 'span-all' }, field('내용', h('textarea', { name: 'detail', value: cur.detail || '' }))),
      field('상태', select('status', L.ISSUE_STATUS.map(function (s) { return [s, s]; }), cur.status)),
      field('담당자', input('owner', cur.owner)),
      field('기한', input('due', cur.due, { type: 'date' })),
      x ? field('등록일 · 종결일', h('div', { class: 'readonly-val' }, (x.created || '') + (x.closed ? ' · 종결 ' + x.closed : ''))) : h('div'),
      h('div', { class: 'span-all' }, field('조치 내용', h('textarea', { name: 'action', value: cur.action || '' }))),
      h('div', { class: 'span-all' }, h('div', { class: 'field' }, h('span', null, '근거 첨부 (Outlook MSG 등)'), evBox,
        h('div', { class: 'form-grid' }, evName, evLink),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () {
            if (!evName.value.trim() && !evLink.value.trim()) return;
            evidence.push({ name: evName.value.trim() || evLink.value.trim(), link: evLink.value.trim() });
            evName.value = ''; evLink.value = ''; drawEv();
          } }, '근거 추가'),
          filePicker(function (names) { names.forEach(function (n) { evidence.push({ name: n, link: evLink.value.trim() }); }); drawEv(); }, true)),
        h('small', { class: 'note' }, '파일을 고르면 파일명만 기록합니다. 파일 자체는 저장소 링크의 위치에 두십시오.'))),
      h('div', { class: 'err span-all', id: 'dlgErr', role: 'alert' }));
    var buttons = [{ label: '취소' }];
    if (x) buttons.push({ label: '삭제', danger: true, onClick: function () {
      db.issues = db.issues.filter(function (o) { return o.id !== x.id; }); save(); toast(x.no + ' 이슈를 삭제했습니다.'); render();
    } });
    buttons.push({ label: '저장', primary: true, onClick: function () {
      var r = L.saveIssue(db, { id: x && x.id, modelId: val(form, 'modelId'), stageId: val(form, 'stageId'), title: val(form, 'title'),
        detail: val(form, 'detail'), status: val(form, 'status'), owner: val(form, 'owner'), due: val(form, 'due'),
        action: val(form, 'action'), evidence: evidence }, today());
      if (r.error) { form.querySelector('#dlgErr').textContent = r.error; return false; }
      save(); toast(r.issue.no + ' 이슈를 저장했습니다.'); render();
    } });
    dialog(x ? x.no + ' 이슈 수정' : '이슈 등록', form, buttons);
  }

  // ── 자료 목록 ─────────────────────────────────────────────
  function viewDocs(modelId) {
    var m = modelId ? modelById(modelId) : null;
    if (modelId && !m) return h('div', { class: 'card' }, h('p', null, '기종을 찾을 수 없습니다.'));
    var head = h('div', { class: 'page-head' }, h('h1', null, m ? m.name + ' · 자료 목록' : '자료 목록 (전체 기종)'),
      h('div', { class: 'btn-row' }, m ? linkButton(m.repoLink, '저장소') : null,
        h('button', { type: 'button', class: 'btn btn-primary', disabled: db.models.length ? null : true, onclick: function () { editDocDialog(null, modelId); } }, '자료 등록')));
    var picker = h('div', { class: 'card' }, h('div', { class: 'filters' },
      field('기종', select('model', modelOptions('전체 기종'), modelId || '')),
      field('단계', select('stage', stageOptions('전체 단계'), '')),
      field('검색', input('q', '', { placeholder: '파일명·메모' }))));
    picker.querySelector('[name=model]').addEventListener('change', function (e) { go(e.target.value ? '#/docs/' + e.target.value : '#/docs'); });
    var box = h('div');
    function redraw() {
      var st = val(picker, 'stage'), q = val(picker, 'q').toLowerCase();
      var list = db.docs.filter(function (d) {
        return (!modelId || d.modelId === modelId) && (!st || d.stageId === st) && (!q || (d.name + ' ' + d.memo).toLowerCase().indexOf(q) >= 0);
      }).sort(function (a, b) { return (b.added || '').localeCompare(a.added || ''); });
      box.textContent = '';
      append(box, h('div', { class: 'list-meta' }, h('span', null, list.length + '건')));
      if (!list.length) { append(box, h('div', { class: 'card' }, h('p', null, db.docs.length ? '조건에 맞는 자료가 없습니다.' : '등록된 자료가 없습니다.'))); return; }
      append(box, tableWrap(h('table', { class: 'list' },
        h('thead', null, h('tr', null, [modelId ? null : '기종', '단계', '파일명', '종류', '저장 위치', '메모', '등록일'].filter(Boolean).map(function (c) { return h('th', null, c); }))),
        h('tbody', null, list.map(function (d) {
          var mm = modelById(d.modelId);
          return h('tr', { tabindex: '0', title: '눌러서 수정', onclick: function (e) { if (e.target.closest('a,button')) return; editDocDialog(d, d.modelId); },
            onkeydown: function (e) { if (e.key === 'Enter' && e.target === e.currentTarget) editDocDialog(d, d.modelId); } },
            modelId ? null : h('td', null, mm ? mm.name : ''), h('td', null, stageName(d.stageId)),
            h('td', { class: 'clip' }, d.name), h('td', { class: 'nowrap' }, d.kind),
            h('td', null, d.link ? linkButton(d.link, '위치') : '—'), h('td', { class: 'clip' }, d.memo), h('td', { class: 'nowrap' }, d.added));
        })))));
    }
    picker.querySelector('[name=stage]').addEventListener('change', redraw);
    picker.querySelector('[name=q]').addEventListener('input', redraw);
    redraw();
    return [head, h('p', { class: 'note' }, '1단계에서는 파일 자체를 올리지 않고 파일명·단계·저장 위치(링크)·메모를 목록으로 관리합니다. 파일 보관 위치는 사내 보안 기준 확인 후 정합니다(기획서 10장 2번).'), picker, box];
  }
  function editDocDialog(d, modelId) {
    var cur = d || { modelId: modelId || (db.models[0] && db.models[0].id) };
    var nameIn = input('name', cur.name, { placeholder: '예: 시작품_치수측정.xlsx' });
    var kindIn = input('kind', cur.kind, { placeholder: '비우면 확장자로 자동' });
    var form = h('div', { class: 'form-grid' },
      field('기종', select('modelId', modelOptions(), cur.modelId)),
      field('개발 단계', select('stageId', stageOptions(), cur.stageId)),
      h('div', { class: 'span-all' }, field('파일명', nameIn)),
      h('div', { class: 'span-all' }, filePicker(function (names) { if (names[0]) { nameIn.value = names[0]; kindIn.value = L.docKind(names[0]); } }, false),
        h('small', { class: 'note' }, ' 파일을 고르면 파일명만 채웁니다.')),
      field('종류', kindIn),
      field('저장 위치(링크)', input('link', cur.link, { placeholder: '공유 폴더 경로 또는 주소' })),
      h('div', { class: 'span-all' }, field('메모', input('memo', cur.memo))),
      h('div', { class: 'err span-all', id: 'dlgErr', role: 'alert' }));
    var buttons = [{ label: '취소' }];
    if (d) buttons.push({ label: '삭제', danger: true, onClick: function () { db.docs = db.docs.filter(function (o) { return o.id !== d.id; }); save(); toast('자료를 목록에서 뺐습니다.'); render(); } });
    buttons.push({ label: '저장', primary: true, onClick: function () {
      var r = L.saveDoc(db, { id: d && d.id, modelId: val(form, 'modelId'), stageId: val(form, 'stageId'), name: val(form, 'name'),
        kind: val(form, 'kind'), link: val(form, 'link'), memo: val(form, 'memo') }, today());
      if (r.error) { form.querySelector('#dlgErr').textContent = r.error; return false; }
      save(); toast('자료를 저장했습니다.'); render();
    } });
    dialog(d ? '자료 수정' : '자료 등록', form, buttons);
  }

  // ── 일정 Excel 가져오기 ────────────────────────────────────
  function readWorkbook(file, cb) {
    var reader = new FileReader();
    var isCsv = /\.csv$/i.test(file.name);
    reader.onload = function () {
      try {
        var wb;
        if (isCsv) {
          var bytes = new Uint8Array(reader.result);
          var text = new TextDecoder('utf-8').decode(bytes);
          if (text.indexOf('�') >= 0) { try { text = new TextDecoder('euc-kr').decode(bytes); } catch (e) { /* 그대로 */ } }
          wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
        } else wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        var sheets = {};
        wb.SheetNames.forEach(function (n) { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
        cb(null, { names: wb.SheetNames, sheets: sheets, file: file.name });
      } catch (e) { cb(e); }
    };
    reader.onerror = function () { cb(reader.error || new Error('읽기 실패')); };
    reader.readAsArrayBuffer(file);
  }
  function startImport(book) {
    var sheet = book.names[0];
    var hr = L.guessHeaderRow(book.sheets[sheet]);
    var tb = L.tableFromMatrix(book.sheets[sheet], hr);
    importState = { book: book, sheet: sheet, headerRow: hr, table: tb, map: L.guessMapping(tb.headers, db.settings.mapping),
      addModels: true, addStages: !db.stages.length };
    render();
  }
  function viewImport() {
    var head = h('div', { class: 'page-head' }, h('h1', null, '개발 기종 일정 Excel 가져오기'));
    var intro = h('div', { class: 'card' },
      h('p', null, '한 행에 「기종 · 개발 단계 · 시작일 · 종료일 · 담당자」가 들어 있는 표를 가정합니다(기획서 8장). 실제 양식의 열 이름이 달라도 다음 단계에서 짝을 맞출 수 있습니다.'),
      h('div', { class: 'btn-row' },
        field('Excel·CSV 파일', h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', onchange: function (e) {
          var f = e.target.files[0]; if (!f) return;
          readWorkbook(f, function (err, book) { if (err) { toast('파일을 읽지 못했습니다: ' + err.message, true); return; } startImport(book); });
        } })),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          var m = Sample.scheduleMatrix(new Date());
          startImport({ names: ['예시 일정'], sheets: { '예시 일정': m }, file: '예시데이터_개발일정(가상)' });
        } }, '예시 일정 표로 연습하기')),
      h('p', { class: 'note' }, '연습용 파일은 samples/예시데이터_개발일정.xlsx 에도 있습니다. 모두 가상 데이터입니다.'));
    if (!importState) return [head, intro];
    var st = importState;
    var matrix = st.book.sheets[st.sheet];
    var opts = st.table.headers.map(function (x) { return [x, x]; });
    var mapBox = h('div', { class: 'mapping' }, L.IMPORT_FIELDS.map(function (f) {
      var sel = select('map_' + f.key, [['', '(지정 안 함)']].concat(opts), st.map[f.key]);
      sel.addEventListener('change', function () { st.map[f.key] = sel.value; render(); });
      return field(f.label + (f.required ? ' (필수)' : ''), sel);
    }));
    var sheetSel = select('sheet', st.book.names.map(function (n) { return [n, n]; }), st.sheet);
    sheetSel.addEventListener('change', function () {
      st.sheet = sheetSel.value; st.headerRow = L.guessHeaderRow(st.book.sheets[st.sheet]);
      st.table = L.tableFromMatrix(st.book.sheets[st.sheet], st.headerRow); st.map = L.guessMapping(st.table.headers, db.settings.mapping); render();
    });
    var hrIn = input('headerRow', String(st.headerRow + 1), { type: 'number', min: '1', max: String(Math.max(1, matrix.length)) });
    hrIn.addEventListener('change', function () {
      var n = Math.max(1, Math.min(matrix.length, parseInt(hrIn.value, 10) || 1));
      st.headerRow = n - 1; st.table = L.tableFromMatrix(matrix, st.headerRow); st.map = L.guessMapping(st.table.headers, db.settings.mapping); render();
    });
    var optBox = h('div', { class: 'btn-row' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'addModels', checked: st.addModels, onchange: function (e) { st.addModels = e.target.checked; render(); } }), '목록에 없는 기종은 새로 추가'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'addStages', checked: st.addStages, onchange: function (e) { st.addStages = e.target.checked; render(); } }), '공통 단계에 없는 단계는 끝에 추가'));
    var mapErr = L.checkMapping(st.map);
    var preview = mapErr ? h('div', { class: 'alert warn' }, mapErr) : (function () {
      var r = L.importSchedule(db, st.table.rows, st.map, { addModels: st.addModels, addStages: st.addStages }, false);
      return h('div', null,
        h('div', { class: 'alert info', id: 'importPreview' }, '새 일정 ' + r.added + '건 · 수정 ' + r.updated + '건 · 건너뜀 ' + r.skipped.length + '건' +
          (r.newModels.length ? ' · 새 기종 ' + r.newModels.length + '개(' + r.newModels.join(', ') + ')' : '') +
          (r.newStages.length ? ' · 새 단계 ' + r.newStages.length + '개(' + r.newStages.join(', ') + ')' : '')),
        r.skipped.length ? h('details', null, h('summary', null, '건너뛸 행 보기'), h('ul', { class: 'skip-list' }, r.skipped.map(function (s) { return h('li', null, s.row + '행 — ' + s.reason); }))) : null,
        h('div', { class: 'submit-bar' },
          h('button', { type: 'button', class: 'btn', onclick: function () { importState = null; render(); } }, '취소'),
          h('button', { type: 'button', class: 'btn btn-primary btn-big', disabled: r.added + r.updated ? null : true, onclick: function () {
            var res = L.importSchedule(db, st.table.rows, st.map, { addModels: st.addModels, addStages: st.addStages }, true);
            db.settings.mapping = Object.assign({}, st.map);
            save(); importState = null;
            toast('가져왔습니다: 새 일정 ' + res.added + '건, 수정 ' + res.updated + '건');
            go('#/status');
          } }, '가져오기 실행')));
    })();
    var sample = st.table.rows.slice(0, 5);
    var previewTable = tableWrap(h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, '행'), st.table.headers.map(function (x) { return h('th', null, x); }))),
      h('tbody', null, sample.map(function (r) { return h('tr', null, h('td', null, String(r._row)), st.table.headers.map(function (x) {
        var v = r[x];
        if ((x === st.map.start || x === st.map.end) && typeof v === 'number') v = L.normalizeDate(v) || v;
        return h('td', null, String(v));
      })); }))));
    return [head, intro, h('div', { class: 'card' },
      h('h2', null, '1. 시트와 머리행'), h('p', { class: 'note' }, '파일: ' + st.book.file),
      h('div', { class: 'form-grid' }, field('시트', sheetSel), field('머리행(열 이름이 있는 행 번호)', hrIn)),
      h('h3', null, '앞부분 미리보기'), previewTable),
      h('div', { class: 'card' }, h('h2', null, '2. 열 이름 짝 맞추기'), mapBox, h('p', { class: 'note' }, '맞춘 짝은 다음 가져오기 때 다시 씁니다.')),
      h('div', { class: 'card' }, h('h2', null, '3. 확인하고 가져오기'), optBox,
        h('p', { class: 'note' }, '같은 기종·단계의 일정이 이미 있으면 날짜와 담당자만 새 값으로 바꾸고, 완료 표시와 메모는 그대로 둡니다.'), preview)];
  }

  // ── 과제 A · Bench Marking ────────────────────────────────
  function bmById(id) { var i = L.indexById(db.bm, id); return i >= 0 ? db.bm[i] : null; }
  var BM_NOTE = '경쟁사 공식 홈페이지에서 누구나 내려받을 수 있는 공개 자료만 다룹니다. 사내 기종 정보·일정·검증 목표는 프롬프트에 넣지 마십시오(기획서 3장, 2026-09-28 수강생 답변).';
  function viewBmList() {
    var head = h('div', { class: 'page-head' }, h('h1', null, 'Bench Marking 경쟁사 비교 분석'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var b = L.newBm(''); b.created = today(); db.bm.push(b); save(); go('#/bm/' + b.id);
      } }, '새 분석'));
    var steps = h('div', { class: 'card' }, h('p', null, '1단계 흐름: 시장·기종 입력 → 점유율 1~5위 브랜드 선정(담당자) → 내려받은 공개 자료 등록 → 요약 프롬프트 복사 → NotebookLM·Dify에 자료와 함께 넣기 → 답변 붙여 넣기 → 출처 확인·리포트 내려받기'),
      h('div', { class: 'alert info' }, BM_NOTE));
    if (!db.bm.length) return [head, steps, h('div', { class: 'card' }, h('p', null, '아직 분석이 없습니다. 「새 분석」을 누르십시오.'))];
    return [head, steps, tableWrap(h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['시장·기종', '작성일', '브랜드', '공개 자료', '리포트'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, db.bm.map(function (b) {
        var parsed = b.answer ? L.parseBmAnswer(b.answer, b) : null;
        return h('tr', { tabindex: '0', onclick: function () { go('#/bm/' + b.id); }, onkeydown: function (e) { if (e.key === 'Enter') go('#/bm/' + b.id); } },
          h('td', null, h('a', { href: '#/bm/' + b.id }, b.market || '(시장·기종 미입력)')), h('td', { class: 'nowrap' }, b.created || ''),
          h('td', null, b.brands.map(function (x) { return x.rank + '위 ' + x.name; }).join(', ') || '—'),
          h('td', null, b.sources.length + '건'),
          h('td', null, parsed ? '있음 (신규 기능 ' + parsed.features.length + ' · Sales Point ' + parsed.sales.length + ' · 스펙 ' + parsed.specs.length + ')' : '없음'));
      }))))];
  }
  function viewBm(id) {
    var b = bmById(id);
    if (!b) return h('div', { class: 'card' }, h('p', null, '분석을 찾을 수 없습니다.'), h('a', { href: '#/bm' }, '목록으로'));
    var head = h('div', { class: 'page-head' }, h('h1', null, b.market || '새 Bench Marking 분석'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/bm' }, '목록'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          confirmBox('분석 삭제', '이 분석(브랜드·공개 자료·답변)을 지웁니다.', '삭제', function () { db.bm = db.bm.filter(function (x) { return x.id !== b.id; }); save(); go('#/bm'); });
        } }, '삭제')));
    // 1. 시장·기종 + 브랜드 + 스펙 항목
    var brandRows = [1, 2, 3, 4, 5].map(function (rank) {
      var cur = b.brands.filter(function (x) { return x.rank === rank; })[0] || {};
      return h('tr', { 'data-rank': String(rank) }, h('th', { scope: 'row' }, rank + '위'),
        h('td', null, h('input', { type: 'text', name: 'bname', value: cur.name || '', 'aria-label': rank + '위 브랜드', class: 'wide' })),
        h('td', null, h('input', { type: 'text', name: 'bnote', value: cur.note || '', 'aria-label': rank + '위 선정 근거', class: 'wide' })));
    });
    var basics = h('div', { class: 'card' }, h('h2', null, '1. 시장·기종과 브랜드'),
      h('div', { class: 'form-grid' },
        field('대상 시장·기종', input('market', b.market, { placeholder: '예: 2톤급 미니 굴착기 시장' })),
        field('비교할 스펙 항목 (한 줄에 하나)', h('textarea', { name: 'specs', value: b.specs.join('\n'), rows: '4', placeholder: '예: 운전중량' }),
          '꼭 비교할 항목은 수강생 확인 후 정합니다(기획서 10장 10번).')),
      h('h3', null, '점유율 1~5위 브랜드 (기종 담당자 선정)'),
      tableWrap(h('table', { class: 'list sched-edit' }, h('thead', null, h('tr', null, h('th', null, '순위'), h('th', null, '브랜드'), h('th', null, '선정 근거'))),
        h('tbody', null, brandRows))),
      h('div', { class: 'err', id: 'bmErr', role: 'alert' }),
      h('div', { class: 'submit-bar' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var list = Array.prototype.map.call(basics.querySelectorAll('tbody tr[data-rank]'), function (tr) {
          return { rank: tr.getAttribute('data-rank'), name: val(tr, 'bname'), note: val(tr, 'bnote') };
        });
        var r = L.cleanBrands(list);
        if (r.error) { basics.querySelector('#bmErr').textContent = r.error; return; }
        b.market = val(basics, 'market').trim(); b.brands = r.brands;
        b.specs = val(basics, 'specs').split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        save(); toast('저장했습니다.'); render();
      } }, '저장')));
    // 2. 공개 자료
    var srcForm = h('div', { class: 'form-grid cols-4' },
      field('브랜드', select('sbrand', b.brands.map(function (x) { return [x.name, x.name]; }).concat([['기타', '기타']]), '')),
      field('자료 종류', select('skind', L.BM_SOURCE_KINDS.map(function (k) { return [k, k]; }), '브로셔')),
      field('제목', input('stitle', '', { placeholder: '자료 제목' })),
      field('출처 주소', input('surl', '', { placeholder: 'https://… (공식 홈페이지)' })),
      h('div', { class: 'span-all' }, field('내려받은 파일명', input('sfile', '')), filePicker(function (names) { if (names[0]) srcForm.querySelector('[name=sfile]').value = names[0]; }, false)));
    var sources = h('div', { class: 'card' }, h('h2', null, '2. 공개 자료 목록'),
      b.sources.length ? tableWrap(h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['번호', '브랜드', '종류', '제목', '출처', '파일명', ''].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, b.sources.map(function (s) {
          return h('tr', null, h('td', { class: 'nowrap' }, s.sid), h('td', null, s.brand), h('td', null, s.kind), h('td', { class: 'clip' }, s.title),
            h('td', null, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, '열기') : '—'), h('td', { class: 'clip' }, s.file || '—'),
            h('td', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { b.sources = b.sources.filter(function (o) { return o !== s; }); save(); render(); } }, '빼기')));
        })))) : h('p', { class: 'note' }, '아직 등록한 자료가 없습니다.'),
      h('h3', null, '자료 추가'), srcForm,
      h('div', { class: 'err', id: 'srcErr', role: 'alert' }),
      h('div', { class: 'submit-bar' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var title = val(srcForm, 'stitle').trim(), url = val(srcForm, 'surl').trim(), file = val(srcForm, 'sfile').trim();
        if (!title && !file) { sources.querySelector('#srcErr').textContent = '제목이나 파일명을 적어 주십시오.'; return; }
        if (url && !isWebLink(url)) { sources.querySelector('#srcErr').textContent = '출처 주소는 http:// 또는 https:// 로 시작해야 합니다.'; return; }
        b.sources.push({ sid: L.nextSourceId(b), brand: val(srcForm, 'sbrand'), kind: val(srcForm, 'skind'), title: title || file, url: url, file: file });
        save(); toast('자료를 추가했습니다.'); render();
      } }, '자료 추가')));
    // 3. 프롬프트
    var prompt = L.buildBmPrompt(b);
    var promptCard = h('div', { class: 'card' }, h('h2', null, '3. 요약 프롬프트'),
      h('div', { class: 'alert info' }, BM_NOTE),
      h('pre', { class: 'prompt-box', id: 'bmPrompt' }, prompt),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt, '프롬프트를 복사했습니다.'); } }, '프롬프트 복사')),
      h('p', { class: 'note' }, 'NotebookLM(또는 Dify 지식베이스)에 위 공개 자료 파일을 올린 뒤 이 프롬프트를 붙여 넣으십시오.'));
    // 4. 답변 붙여넣기·리포트
    var ans = h('textarea', { name: 'answer', value: b.answer || '', rows: '10', placeholder: '[신규 기능]\n- 브랜드 | 기능 | S1 p.3' });
    var reportBox = h('div', { class: 'report' });
    function drawReport(text) {
      reportBox.textContent = '';
      if (!text.trim()) return;
      var p = L.parseBmAnswer(text, b);
      if (p.noSource.length) append(reportBox, h('div', { class: 'alert warn' }, '출처가 없는 줄 ' + p.noSource.length + '건 — 원문을 확인하기 전에는 쓰지 마십시오: ' + p.noSource.join(' / ')));
      if (p.badSource.length) append(reportBox, h('div', { class: 'alert warn' }, '등록하지 않은 자료 번호를 가리키는 줄 ' + p.badSource.length + '건: ' + p.badSource.join(' / ')));
      if (p.unparsed.length) append(reportBox, h('details', null, h('summary', null, '형식에 맞지 않아 뺀 줄 ' + p.unparsed.length + '건'), h('ul', { class: 'skip-list' }, p.unparsed.map(function (x) { return h('li', null, x); }))));
      function listTable(title, rows) {
        return [h('h3', null, title + ' (' + rows.length + ')'), rows.length ? tableWrap(h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, '브랜드'), h('th', null, '내용'), h('th', null, '출처'))),
          h('tbody', null, rows.map(function (r) { return h('tr', null, h('td', null, r.brand), h('td', null, r.text), h('td', null, r.src || '—')); })))) : h('p', { class: 'note' }, '없음')];
      }
      append(reportBox, listTable('신규 기능', p.features));
      append(reportBox, listTable('Sales Point', p.sales));
      var st = L.specTable(p.specs, b.brands, b.specs);
      append(reportBox, [h('h3', null, '스펙 비교'), st.rows.length ? tableWrap(h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, '항목'), st.brands.map(function (x) { return h('th', null, x); }))),
        h('tbody', null, st.rows.map(function (r) { return h('tr', null, h('th', { scope: 'row' }, r.item), r.values.map(function (v) { return h('td', null, v || '—'); })); })))) : h('p', { class: 'note' }, '없음')]);
      if (p.summary.length) append(reportBox, [h('h3', null, '한줄 요약'), h('ul', null, p.summary.map(function (x) { return h('li', null, x); }))]);
    }
    drawReport(b.answer || '');
    var answerCard = h('div', { class: 'card' }, h('h2', null, '4. AI 답변 붙여 넣기 · 리포트'),
      field('AI 답변', ans),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () { drawReport(ans.value); } }, '나누어 보기'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { b.answer = ans.value; save(); drawReport(ans.value); toast('답변을 저장했습니다.'); } }, '답변 저장'),
        h('button', { type: 'button', class: 'btn', onclick: function () { exportBmReport(b, ans.value); } }, '리포트 엑셀 내려받기')),
      reportBox);
    return [head, basics, sources, promptCard, answerCard];
  }
  function exportBmReport(b, text) {
    var p = L.parseBmAnswer(text || '', b);
    var st = L.specTable(p.specs, b.brands, b.specs);
    var sheets = {
      '개요': [['항목', '내용'], ['시장·기종', b.market], ['작성일', b.created], ['브랜드', b.brands.map(function (x) { return x.rank + '위 ' + x.name; }).join(', ')],
        ['주의', '공개 자료를 AI로 요약한 결과입니다. 출처 원문을 확인한 뒤 쓰십시오.'], ['출처 없는 줄', p.noSource.length], ['없는 자료 번호', p.badSource.length]],
      '신규기능': [['브랜드', '내용', '출처']].concat(p.features.map(function (r) { return [r.brand, r.text, r.src]; })),
      'SalesPoint': [['브랜드', '내용', '출처']].concat(p.sales.map(function (r) { return [r.brand, r.text, r.src]; })),
      '스펙비교': [['항목'].concat(st.brands)].concat(st.rows.map(function (r) { return [r.item].concat(r.values); })),
      '공개자료': [['번호', '브랜드', '종류', '제목', '출처 주소', '파일명']].concat(b.sources.map(function (s) { return [s.sid, s.brand, s.kind, s.title, s.url, s.file]; }))
    };
    writeBook(sheets, 'BenchMarking_' + (b.market || '분석').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30) + '_' + fileNameStamp() + '.xlsx');
  }

  // ── 설정 ─────────────────────────────────────────────────
  function viewSettings() {
    var stagesTa = h('textarea', { name: 'stages', rows: '7', value: L.sortedStages(db).map(function (s) { return s.name; }).join('\n') });
    var soonIn = input('soon', String(soonDays()), { type: 'number', min: '0', max: '365' });
    var err = h('div', { class: 'err', role: 'alert' });
    return [h('div', { class: 'page-head' }, h('h1', null, '설정')),
      h('div', { class: 'card' }, h('h2', null, '공통 개발 단계'),
        h('p', { class: 'note' }, '개발 단계 구분은 전 기종 공통입니다(2026-09-28 수강생 답변). 한 줄에 하나씩, 진행 순서대로 적으십시오. 실제 단계 명칭은 사내 양식을 받은 뒤 맞춥니다.'),
        field('단계 (위에서부터 순서)', stagesTa), err,
        h('div', { class: 'submit-bar' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var r = L.setStages(db, stagesTa.value.split(/\n/));
          if (r.error) { err.textContent = r.error; return; }
          save(); toast('공통 단계를 저장했습니다.'); render();
        } }, '단계 저장'))),
      h('div', { class: 'card' }, h('h2', null, '임박 기준'),
        field('종료일까지 며칠 남으면 「임박」으로 표시할지', soonIn, '0이면 종료일 당일만 임박입니다.'),
        h('div', { class: 'submit-bar' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var n = parseInt(soonIn.value, 10);
          if (!(n >= 0 && n <= 365)) { toast('0~365 사이 숫자를 넣어 주십시오.', true); return; }
          db.settings.soonDays = n; save(); toast('임박 기준을 ' + n + '일로 바꿨습니다.');
        } }, '저장')))];
  }

  // ── 데이터 ───────────────────────────────────────────────
  function viewData() {
    var sm = L.summary(db, today(), soonDays());
    return [h('div', { class: 'page-head' }, h('h1', null, '데이터 관리')),
      h('div', { class: 'card' }, h('h2', null, '지금 이 브라우저에 있는 데이터'),
        h('p', null, '기종 ' + sm.models + '개 · 단계 ' + db.stages.length + '개 · 일정 ' + db.schedules.length + '건 · 이슈 ' + db.issues.length + '건 · 자료 ' + db.docs.length + '건 · Bench Marking ' + db.bm.length + '건' + (db._sample ? ' (예시 데이터)' : '')),
        h('p', { class: 'note' }, '데이터는 이 브라우저(localStorage)에만 있습니다. 다른 PC·다른 사람과 나누거나 보관하려면 엑셀로 내보내십시오. 팀 공유 저장소는 2단계입니다.')),
      h('div', { class: 'card' }, h('h2', null, '엑셀로 보관·옮기기'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var sheets = L.dbToSheets(db, today());
            var out = { '현황표': L.boardSheet(db, today(), soonDays()) };
            Object.keys(sheets).forEach(function (k) { out[k] = sheets[k]; });
            writeBook(out, '선행품질_전체_' + fileNameStamp() + '.xlsx');
          } }, '엑셀 내보내기(전체 시트)'),
          field('내보낸 엑셀 다시 가져오기(지금 데이터를 바꿉니다)', h('input', { type: 'file', accept: '.xlsx,.xls', name: 'restore', onchange: function (e) {
            var f = e.target.files[0]; if (!f) return;
            readWorkbook(f, function (err, book) {
              e.target.value = '';
              if (err) { toast('파일을 읽지 못했습니다: ' + err.message, true); return; }
              var res = L.sheetsToDb(book.sheets, db);
              if (!res.report.read.length) { dialog('가져오기 결과', h('p', null, res.report.problems.join(' ')), null); return; }
              db = res.db; save(); render();
              dialog('가져오기 결과', [h('p', null, '읽은 시트: ' + res.report.read.join(', ')),
                res.report.problems.length ? h('ul', { class: 'skip-list' }, res.report.problems.map(function (x) { return h('li', null, x); })) : null], null);
            });
          } }))),
        h('p', { class: 'note' }, '개발 일정 Excel(사내 양식)은 「일정 가져오기」 메뉴를 쓰십시오. 이 칸은 이 도구가 내보낸 파일을 되살리는 곳입니다.')),
      h('div', { class: 'card' }, h('h2', null, '예시 데이터·초기화'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () {
            confirmBox('예시 데이터 불러오기', '지금 데이터를 지우고 예시 데이터(가상)를 불러옵니다.', '불러오기', function () { loadSample(); toast('예시 데이터를 불러왔습니다.'); go('#/status'); });
          } }, '예시 데이터 불러오기'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            confirmBox('전체 삭제', '이 브라우저의 데이터를 모두 지웁니다. 되돌릴 수 없습니다.', '전체 삭제', function () { resetDb(); toast('모두 지웠습니다.'); render(); });
          } }, '전체 삭제')))];
  }

  // ── 라우터 ───────────────────────────────────────────────
  function render() {
    var route = location.hash || '#/status';
    var parts = route.split('/');
    renderNav(route);
    var view;
    switch (parts[1]) {
      case 'models': view = viewModels(); break;
      case 'model': view = viewModel(parts[2]); break;
      case 'issues': view = viewIssues(parts[2]); break;
      case 'docs': view = viewDocs(parts[2]); break;
      case 'import': view = viewImport(); break;
      case 'bm': view = parts[2] ? viewBm(parts[2]) : viewBmList(); break;
      case 'settings': view = viewSettings(); break;
      case 'data': view = viewData(); break;
      default: view = viewStatus();
    }
    main.textContent = '';
    append(main, view);
    main.setAttribute('data-route', route);
  }
  window.addEventListener('hashchange', function () {
    var d = document.getElementById('dialog'); if (d.open) d.close();
    render(); window.scrollTo(0, 0);
  });
  // 대화상자 안에서 Enter 를 눌러도 저장하지 않은 채 닫히지 않게 막습니다.
  document.querySelector('#dialog form').addEventListener('submit', function (e) { e.preventDefault(); });
  if (!S.available()) document.getElementById('storageBanner').hidden = false;
  banner();
  render();
})();

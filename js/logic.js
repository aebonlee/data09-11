/*
 * 선행품질 업무 지원 통합 웹 Agent — 순수 로직 (화면·저장소와 무관)
 *   과제 B: 기종·공통 개발 단계·일정·이슈 관리함·자료 목록, 일정 Excel 가져오기(열 이름 매핑)
 *   과제 A: Bench Marking 요약 프롬프트 만들기·답변 나누기(출처 확인)
 * 브라우저에서는 window.DQLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 파일(file://)로 열면 브라우저가 module 스크립트를 막기 때문입니다.
 */
(function (root) {
  'use strict';

  // ── 코드값 ─────────────────────────────────────────────
  // 이슈 상태 3종은 기획서 5장(가정)을 따릅니다. 세부 항목은 수강생 샘플을 받은 뒤 확정합니다.
  var ISSUE_STATUS = ['열림', '조치중', '종결'];
  // 일정 상태: 우선순위 순서대로 판정합니다.
  var SCHED_STATUS = { DONE: '완료', LATE: '지연', SOON: '임박', DOING: '진행중', PLANNED: '예정', NODATE: '일정 미정' };
  var DOC_KINDS = { pdf: 'PDF', xls: 'Excel', xlsx: 'Excel', xlsm: 'Excel', csv: 'Excel', ppt: 'PPT', pptx: 'PPT',
    jpg: '이미지', jpeg: '이미지', png: '이미지', gif: '이미지', bmp: '이미지', msg: 'Outlook MSG', eml: '메일',
    doc: 'Word', docx: 'Word', hwp: '한글', hwpx: '한글', txt: '텍스트', zip: '압축' };
  var BM_SOURCE_KINDS = ['브로셔', '카탈로그', 'Spec sheet', '정비 매뉴얼', '기타'];

  // 일정 Excel 가져오기 필드(기획서 8장 1단계의 가정 양식) — 자동 매핑용 동의어
  var IMPORT_FIELDS = [
    { key: 'model', label: '기종', required: true, synonyms: ['기종', '기종명', '모델', '모델명', 'model', '장비'] },
    { key: 'stage', label: '개발 단계', required: true, synonyms: ['개발 단계', '개발단계', '단계', 'stage', 'phase', '마일스톤'] },
    { key: 'start', label: '시작일', required: false, synonyms: ['시작일', '시작', '착수일', '착수', 'start', '시작 예정일'] },
    { key: 'end', label: '종료일', required: false, synonyms: ['종료일', '종료', '완료일', '완료 예정일', '완료예정일', '마감', '마감일', 'end', 'due'] },
    { key: 'owner', label: '담당자', required: false, synonyms: ['담당자', '담당', 'owner', '책임자'] },
    { key: 'memo', label: '메모', required: false, synonyms: ['메모', '비고', 'note', 'remark'] }
  ];

  function emptyDb() {
    return { models: [], stages: [], schedules: [], issues: [], docs: [], bm: [],
      settings: { soonDays: 7, mapping: {} } };
  }

  // ── 공용 도우미 ────────────────────────────────────────
  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/\s+/g, ''); }
  var idSeq = 0;
  function newId(prefix) {
    idSeq++;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + idSeq.toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  // 날짜 차이(b - a, 일). 시각은 무시합니다.
  function daysBetween(a, b) {
    var da = typeof a === 'string' ? parseYmd(a) : new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var dbb = typeof b === 'string' ? parseYmd(b) : new Date(b.getFullYear(), b.getMonth(), b.getDate());
    if (!da || !dbb) return null;
    return Math.round((Date.UTC(dbb.getFullYear(), dbb.getMonth(), dbb.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
  }

  // Excel 에서 온 날짜 값을 YYYY-MM-DD 로. 알아볼 수 없으면 '' 를 돌려줍니다.
  //  숫자 = Excel 날짜 일련번호(1900 체계), Date 객체, 2026-10-01 / 2026.10.1 / 2026/10/01 / 20261001
  function normalizeDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : ymd(v);
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return ''; // 1954~2119 범위 밖이면 날짜로 보지 않음
      // 시각이 붙은 값은 그날로 보고, 23:59:59 근처의 오차(시간대 변환 흔적)는 다음 날로 올립니다.
      var day = v - Math.floor(v) > 0.999 ? Math.ceil(v) : Math.floor(v);
      var ms = (day - 25569) * 86400000;
      var u = new Date(ms);
      return u.getUTCFullYear() + '-' + pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate());
    }
    var s = str(v).replace(/\s+/g, '').replace(/\.$/, '');
    var m = /^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return ymd(dt);
  }

  function docKind(fileName) {
    var m = /\.([a-z0-9]+)$/i.exec(str(fileName));
    return m ? (DOC_KINDS[m[1].toLowerCase()] || m[1].toUpperCase()) : '';
  }

  // ── 기종·단계 ─────────────────────────────────────────
  function findModelByName(db, name) {
    var n = norm(name);
    for (var i = 0; i < db.models.length; i++) if (norm(db.models[i].name) === n) return db.models[i];
    return null;
  }
  function findStageByName(db, name) {
    var n = norm(name);
    for (var i = 0; i < db.stages.length; i++) if (norm(db.stages[i].name) === n) return db.stages[i];
    return null;
  }
  function sortedStages(db) { return db.stages.slice().sort(function (a, b) { return a.order - b.order; }); }

  // 기종 저장(추가·수정). 같은 이름(공백·대소문자 무시)의 다른 기종이 있으면 오류.
  function saveModel(db, m) {
    var name = str(m.name);
    if (!name) return { error: '기종명을 입력해 주십시오.' };
    var dup = findModelByName(db, name);
    if (dup && dup.id !== m.id) return { error: '같은 이름의 기종이 이미 있습니다: ' + dup.name };
    var link = str(m.repoLink);
    var rec = { id: m.id || newId('m'), name: name, owner: str(m.owner), repoLink: link, memo: str(m.memo) };
    var i = indexById(db.models, rec.id);
    if (i >= 0) db.models[i] = rec; else db.models.push(rec);
    return { model: rec };
  }
  // 기종 삭제 — 그 기종의 일정·이슈·자료도 함께 지웁니다. 지운 건수를 돌려줍니다.
  function deleteModel(db, id) {
    var cnt = { schedules: 0, issues: 0, docs: 0 };
    ['schedules', 'issues', 'docs'].forEach(function (k) {
      var before = db[k].length;
      db[k] = db[k].filter(function (x) { return x.modelId !== id; });
      cnt[k] = before - db[k].length;
    });
    db.models = db.models.filter(function (x) { return x.id !== id; });
    return cnt;
  }
  function modelUsage(db, id) {
    function c(k) { return db[k].filter(function (x) { return x.modelId === id; }).length; }
    return { schedules: c('schedules'), issues: c('issues'), docs: c('docs') };
  }

  // 공통 개발 단계 목록을 한꺼번에 바꿉니다. names = 순서대로의 단계 이름.
  //  이름이 같은 기존 단계는 id 를 유지(일정·이슈 연결 보존), 빠진 단계는 사용 중이면 거부합니다.
  function setStages(db, names) {
    var clean = [], seen = {};
    for (var i = 0; i < names.length; i++) {
      var n = str(names[i]);
      if (!n) continue;
      if (seen[norm(n)]) return { error: '단계 이름이 겹칩니다: ' + n };
      seen[norm(n)] = true;
      clean.push(n);
    }
    var removed = db.stages.filter(function (s) { return !seen[norm(s.name)]; });
    var inUse = removed.filter(function (s) {
      return db.schedules.some(function (x) { return x.stageId === s.id; }) ||
        db.issues.some(function (x) { return x.stageId === s.id; }) ||
        db.docs.some(function (x) { return x.stageId === s.id; });
    });
    if (inUse.length) return { error: '일정·이슈·자료에서 쓰는 단계는 뺄 수 없습니다: ' + inUse.map(function (s) { return s.name; }).join(', ') };
    db.stages = clean.map(function (n, idx) {
      var old = findStageByName(db, n);
      return { id: old ? old.id : newId('s'), name: n, order: idx + 1 };
    });
    return { stages: db.stages };
  }

  // ── 일정 ─────────────────────────────────────────────
  function scheduleStatus(s, today, soonDays) {
    if (s.done) return SCHED_STATUS.DONE;
    var t = typeof today === 'string' ? today : ymd(today);
    if (!s.start && !s.end) return SCHED_STATUS.NODATE;
    if (s.end) {
      var left = daysBetween(t, s.end);
      if (left < 0) return SCHED_STATUS.LATE;
      if (left <= soonDays) return SCHED_STATUS.SOON;
    }
    if (s.start && daysBetween(s.start, t) >= 0) return SCHED_STATUS.DOING;
    return SCHED_STATUS.PLANNED;
  }
  function scheduleCheck(s) {
    if (s.start && s.end && daysBetween(s.start, s.end) < 0) return '종료일이 시작일보다 빠릅니다.';
    return '';
  }
  function findSchedule(db, modelId, stageId) {
    for (var i = 0; i < db.schedules.length; i++) {
      var x = db.schedules[i];
      if (x.modelId === modelId && x.stageId === stageId) return x;
    }
    return null;
  }
  // 한 기종·단계의 일정 저장(없으면 추가). 날짜가 모두 비고 담당·메모도 없으면 삭제합니다.
  function saveSchedule(db, modelId, stageId, v) {
    var rec = { start: normalizeDate(v.start), end: normalizeDate(v.end), owner: str(v.owner), done: !!v.done, memo: str(v.memo) };
    if ((v.start && !rec.start) || (v.end && !rec.end)) return { error: '날짜 형식을 알아볼 수 없습니다.' };
    var err = scheduleCheck(rec);
    if (err) return { error: err };
    var cur = findSchedule(db, modelId, stageId);
    var empty = !rec.start && !rec.end && !rec.owner && !rec.memo && !rec.done;
    if (empty) {
      if (cur) db.schedules = db.schedules.filter(function (x) { return x !== cur; });
      return { removed: !!cur };
    }
    if (cur) { cur.start = rec.start; cur.end = rec.end; cur.owner = rec.owner; cur.done = rec.done; cur.memo = rec.memo; return { schedule: cur }; }
    rec.id = newId('p'); rec.modelId = modelId; rec.stageId = stageId;
    db.schedules.push(rec);
    return { schedule: rec };
  }

  // 현황표: 기종마다 공통 단계 순서대로 칸을 만듭니다.
  function statusBoard(db, today, soonDays, filter) {
    var stages = sortedStages(db);
    var f = filter || {};
    var rows = db.models.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).map(function (m) {
      var cells = stages.map(function (st) {
        var s = findSchedule(db, m.id, st.id);
        return { stage: st, schedule: s, status: s ? scheduleStatus(s, today, soonDays) : '' };
      });
      var openIssues = db.issues.filter(function (x) { return x.modelId === m.id && x.status !== '종결'; });
      var overdue = openIssues.filter(function (x) { return issueOverdue(x, today); });
      return { model: m, cells: cells, openIssues: openIssues.length, overdueIssues: overdue.length,
        late: cells.filter(function (c) { return c.status === SCHED_STATUS.LATE; }).length,
        soon: cells.filter(function (c) { return c.status === SCHED_STATUS.SOON; }).length };
    });
    if (f.owner) {
      var o = norm(f.owner);
      rows = rows.filter(function (r) {
        return norm(r.model.owner).indexOf(o) >= 0 || r.cells.some(function (c) { return c.schedule && norm(c.schedule.owner).indexOf(o) >= 0; });
      });
    }
    if (f.attentionOnly) rows = rows.filter(function (r) { return r.late || r.soon || r.overdueIssues; });
    return { stages: stages, rows: rows };
  }

  // 대시보드 합계
  function summary(db, today, soonDays) {
    var c = { models: db.models.length, late: 0, soon: 0, openIssues: 0, overdueIssues: 0, docs: db.docs.length };
    db.schedules.forEach(function (s) {
      var st = scheduleStatus(s, today, soonDays);
      if (st === SCHED_STATUS.LATE) c.late++;
      if (st === SCHED_STATUS.SOON) c.soon++;
    });
    db.issues.forEach(function (x) {
      if (x.status !== '종결') { c.openIssues++; if (issueOverdue(x, today)) c.overdueIssues++; }
    });
    return c;
  }

  // 간트형 막대: 전체 날짜 범위 안에서 왼쪽 위치·폭(%)을 계산합니다.
  //  시작일만 있거나 종료일만 있으면 하루짜리 막대로 그립니다.
  function ganttLayout(schedules, today) {
    var dated = schedules.filter(function (s) { return s.start || s.end; });
    var t = typeof today === 'string' ? today : ymd(today);
    if (!dated.length) return { min: '', max: '', days: 0, bars: [], todayPct: null };
    var min = null, max = null;
    dated.forEach(function (s) {
      var a = s.start || s.end, b = s.end || s.start;
      if (!min || a < min) min = a;
      if (!max || b > max) max = b;
    });
    var days = daysBetween(min, max) + 1;
    var bars = dated.map(function (s) {
      var a = s.start || s.end, b = s.end || s.start;
      return { schedule: s, leftPct: daysBetween(min, a) / days * 100, widthPct: (daysBetween(a, b) + 1) / days * 100 };
    });
    var tp = daysBetween(min, t);
    var todayPct = tp >= 0 && tp < days ? (tp + 0.5) / days * 100 : null;
    return { min: min, max: max, days: days, bars: bars, todayPct: todayPct };
  }

  // ── 일정 Excel 가져오기 ────────────────────────────────
  // 표(2차원 배열)에서 머리행을 찾습니다: 값이 2칸 이상 있는 첫 행.
  function guessHeaderRow(matrix) {
    for (var i = 0; i < Math.min(matrix.length, 30); i++) {
      var filled = (matrix[i] || []).filter(function (c) { return str(c) !== ''; }).length;
      if (filled >= 2) return i;
    }
    return 0;
  }
  function tableFromMatrix(matrix, headerIdx) {
    var head = (matrix[headerIdx] || []).map(function (h, i) { return str(h) || ('열' + (i + 1)); });
    var rows = [];
    for (var r = headerIdx + 1; r < matrix.length; r++) {
      var line = matrix[r] || [];
      if (!line.some(function (c) { return str(c) !== ''; })) continue;
      var o = { _row: r + 1 };
      head.forEach(function (h, i) { o[h] = line[i] == null ? '' : line[i]; });
      rows.push(o);
    }
    return { headers: head, rows: rows };
  }
  // 머리행 이름으로 필드 매핑을 추정합니다. saved(이전에 쓴 매핑)가 맞으면 우선합니다.
  function guessMapping(headers, saved) {
    var map = {};
    IMPORT_FIELDS.forEach(function (f) {
      if (saved && saved[f.key] && headers.indexOf(saved[f.key]) >= 0) { map[f.key] = saved[f.key]; return; }
      var hit = '';
      for (var i = 0; i < f.synonyms.length && !hit; i++) {
        for (var j = 0; j < headers.length; j++) if (norm(headers[j]) === norm(f.synonyms[i])) { hit = headers[j]; break; }
      }
      if (!hit) { // 부분 일치(예: 「개발 단계명」)
        for (var k = 0; k < headers.length && !hit; k++) {
          for (var q = 0; q < f.synonyms.length; q++) {
            if (norm(f.synonyms[q]).length >= 2 && norm(headers[k]).indexOf(norm(f.synonyms[q])) >= 0) { hit = headers[k]; break; }
          }
        }
      }
      map[f.key] = hit;
    });
    // 같은 열이 두 필드에 잡히면 뒤쪽 필드는 비웁니다.
    var used = {};
    IMPORT_FIELDS.forEach(function (f) {
      if (!map[f.key]) return;
      if (used[map[f.key]]) map[f.key] = ''; else used[map[f.key]] = true;
    });
    return map;
  }
  function checkMapping(map) {
    var miss = IMPORT_FIELDS.filter(function (f) { return f.required && !map[f.key]; }).map(function (f) { return f.label; });
    if (miss.length) return '필수 열을 지정해 주십시오: ' + miss.join(', ');
    if (!map.start && !map.end) return '시작일이나 종료일 중 하나는 지정해 주십시오.';
    return '';
  }
  // 가져오기 미리보기 겸 실행. apply=false 면 db 를 바꾸지 않고 결과만 셉니다.
  //  opts.addStages: 목록에 없는 단계를 공통 단계 끝에 추가 / opts.addModels: 없는 기종 추가
  function importSchedule(db, rows, map, opts, apply) {
    opts = opts || {};
    var target = apply ? db : JSON.parse(JSON.stringify(db));
    var res = { added: 0, updated: 0, newModels: [], newStages: [], skipped: [] };
    rows.forEach(function (r) {
      var mName = str(r[map.model]), sName = str(r[map.stage]);
      if (!mName || !sName) { res.skipped.push({ row: r._row, reason: '기종 또는 단계가 비어 있음' }); return; }
      var start = map.start ? normalizeDate(r[map.start]) : '';
      var end = map.end ? normalizeDate(r[map.end]) : '';
      if (map.start && str(r[map.start]) !== '' && !start) { res.skipped.push({ row: r._row, reason: '시작일 형식 오류: ' + str(r[map.start]) }); return; }
      if (map.end && str(r[map.end]) !== '' && !end) { res.skipped.push({ row: r._row, reason: '종료일 형식 오류: ' + str(r[map.end]) }); return; }
      if (start && end && daysBetween(start, end) < 0) { res.skipped.push({ row: r._row, reason: '종료일이 시작일보다 빠름' }); return; }
      var m = findModelByName(target, mName);
      if (!m) {
        if (!opts.addModels) { res.skipped.push({ row: r._row, reason: '등록되지 않은 기종: ' + mName }); return; }
        m = { id: newId('m'), name: mName, owner: '', repoLink: '', memo: '' };
        target.models.push(m); res.newModels.push(mName);
      }
      var st = findStageByName(target, sName);
      if (!st) {
        if (!opts.addStages) { res.skipped.push({ row: r._row, reason: '공통 단계에 없는 단계: ' + sName }); return; }
        st = { id: newId('s'), name: sName, order: target.stages.length + 1 };
        target.stages.push(st); res.newStages.push(sName);
      }
      var cur = findSchedule(target, m.id, st.id);
      var owner = map.owner ? str(r[map.owner]) : '';
      var memo = map.memo ? str(r[map.memo]) : '';
      if (cur) {
        // 가져온 값으로 날짜를 덮어쓰되, 담당자 수정 내용(완료 표시·빈 칸이 아닌 기존 값)은 지킵니다.
        cur.start = start || cur.start; cur.end = end || cur.end;
        if (owner) cur.owner = owner;
        if (memo) cur.memo = memo;
        res.updated++;
      } else {
        target.schedules.push({ id: newId('p'), modelId: m.id, stageId: st.id, start: start, end: end, owner: owner, done: false, memo: memo });
        res.added++;
      }
    });
    return res;
  }

  // ── 이슈 관리함 ───────────────────────────────────────
  function nextIssueNo(issues) {
    var max = 0;
    issues.forEach(function (x) { var m = /^ISS-(\d+)$/.exec(x.no || ''); if (m && +m[1] > max) max = +m[1]; });
    var n = String(max + 1);
    while (n.length < 4) n = '0' + n;
    return 'ISS-' + n;
  }
  function issueOverdue(x, today) {
    if (x.status === '종결' || !x.due) return false;
    return daysBetween(typeof today === 'string' ? today : ymd(today), x.due) < 0;
  }
  // 근거 첨부 문자열 ↔ 목록. 한 줄에 「파일명 | 링크」, 여러 건은 줄바꿈 또는 「; 」.
  function parseEvidence(text) {
    return str(text).split(/\n|;\s*/).map(function (line) {
      var p = line.split('|');
      var name = str(p[0]), link = str(p.slice(1).join('|'));
      return name || link ? { name: name || link, link: link } : null;
    }).filter(Boolean);
  }
  function evidenceText(list) {
    return (list || []).map(function (e) { return e.link ? e.name + ' | ' + e.link : e.name; }).join('; ');
  }
  // 이슈 저장. 종결로 바꾸면 종결일을 오늘로 채우고, 다시 열면 종결일을 비웁니다.
  function saveIssue(db, v, today) {
    var t = typeof today === 'string' ? today : ymd(today);
    var title = str(v.title);
    if (!v.modelId || indexById(db.models, v.modelId) < 0) return { error: '기종을 선택해 주십시오.' };
    if (!title) return { error: '이슈 제목을 입력해 주십시오.' };
    var status = ISSUE_STATUS.indexOf(v.status) >= 0 ? v.status : '열림';
    var due = normalizeDate(v.due);
    if (v.due && !due) return { error: '기한 날짜 형식을 알아볼 수 없습니다.' };
    var i = v.id ? indexById(db.issues, v.id) : -1;
    var old = i >= 0 ? db.issues[i] : null;
    var closed = status === '종결' ? ((old && old.closed) || normalizeDate(v.closed) || t) : '';
    var rec = {
      id: old ? old.id : newId('i'), no: old ? old.no : nextIssueNo(db.issues), modelId: v.modelId,
      stageId: v.stageId || '', title: title, detail: str(v.detail), status: status, owner: str(v.owner),
      created: (old && old.created) || normalizeDate(v.created) || t, due: due, closed: closed,
      action: str(v.action), evidence: Array.isArray(v.evidence) ? v.evidence : parseEvidence(v.evidence)
    };
    if (old) db.issues[i] = rec; else db.issues.push(rec);
    return { issue: rec };
  }
  function filterIssues(db, f, today) {
    f = f || {};
    var q = norm(f.q);
    return db.issues.filter(function (x) {
      if (f.modelId && x.modelId !== f.modelId) return false;
      if (f.stageId && x.stageId !== f.stageId) return false;
      if (f.status === '미종결' && x.status === '종결') return false;
      if (f.status && f.status !== '미종결' && x.status !== f.status) return false;
      if (f.overdueOnly && !issueOverdue(x, today)) return false;
      if (q && (norm(x.title) + norm(x.detail) + norm(x.owner) + norm(x.no) + norm(x.action)).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      // 기한 지남 → 미종결 → 종결, 같은 묶음 안에서는 기한 빠른 순, 기한 없는 것은 뒤
      function rank(x) { return x.status === '종결' ? 2 : issueOverdue(x, today) ? 0 : 1; }
      var d = rank(a) - rank(b);
      if (d) return d;
      if ((a.due || '9') !== (b.due || '9')) return (a.due || '9') < (b.due || '9') ? -1 : 1;
      return a.no < b.no ? -1 : a.no > b.no ? 1 : 0;
    });
  }

  // ── 자료 목록 ─────────────────────────────────────────
  function saveDoc(db, v, today) {
    var name = str(v.name);
    if (!v.modelId || indexById(db.models, v.modelId) < 0) return { error: '기종을 선택해 주십시오.' };
    if (!name) return { error: '파일명(또는 자료 이름)을 입력해 주십시오.' };
    var i = v.id ? indexById(db.docs, v.id) : -1;
    var old = i >= 0 ? db.docs[i] : null;
    var rec = { id: old ? old.id : newId('d'), modelId: v.modelId, stageId: v.stageId || '', name: name,
      kind: str(v.kind) || docKind(name), link: str(v.link), memo: str(v.memo),
      added: (old && old.added) || (typeof today === 'string' ? today : ymd(today)) };
    if (old) db.docs[i] = rec; else db.docs.push(rec);
    return { doc: rec };
  }

  // ── 과제 A · Bench Marking ────────────────────────────
  function newBm(market) {
    return { id: newId('b'), market: str(market), created: '', brands: [], specs: [], sources: [], answer: '' };
  }
  function nextSourceId(bm) {
    var max = 0;
    bm.sources.forEach(function (s) { var m = /^S(\d+)$/.exec(s.sid || ''); if (m && +m[1] > max) max = +m[1]; });
    return 'S' + (max + 1);
  }
  // 브랜드 1~5위 정리: 이름 없는 줄은 버리고, 순위 겹침은 오류
  function cleanBrands(list) {
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var b = list[i], name = str(b.name);
      if (!name) continue;
      var rank = parseInt(b.rank, 10);
      if (!(rank >= 1 && rank <= 5)) return { error: '순위는 1~5 사이로 적어 주십시오: ' + name };
      if (seen[rank]) return { error: rank + '위가 두 번 들어 있습니다.' };
      seen[rank] = true;
      out.push({ rank: rank, name: name, note: str(b.note) });
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    return { brands: out };
  }
  // 요약 프롬프트. 공개 자료 정보만 넣습니다(사내 기종·검증 목표는 넣지 않음 — 기획서 3장).
  function buildBmPrompt(bm) {
    var L = [];
    L.push('너는 건설장비 Bench Marking 조사를 돕는 분석가야.');
    L.push('아래 「공개 자료」로 올린 문서만 근거로 삼아 경쟁 브랜드의 제품을 정리해줘. 문서에 없는 내용은 쓰지 말고, 모르면 「자료에 없음」이라고 적어줘.');
    L.push('');
    L.push('[대상 시장·기종] ' + (bm.market || '[시장·기종]'));
    L.push('[브랜드(담당자 선정 순위)]');
    if (bm.brands.length) bm.brands.forEach(function (b) { L.push(b.rank + '위 ' + b.name); });
    else L.push('[브랜드 1~5위]');
    L.push('[공개 자료]');
    if (bm.sources.length) bm.sources.forEach(function (s) {
      L.push(s.sid + ' · ' + s.brand + ' · ' + s.kind + ' · ' + s.title + (s.url ? ' · ' + s.url : ''));
    });
    else L.push('[S1 · 브랜드 · 자료 종류 · 제목 · 출처 주소]');
    L.push('[비교할 스펙 항목] ' + (bm.specs.length ? bm.specs.join(', ') : '[스펙 항목]'));
    L.push('');
    L.push('답변은 아래 형식만 지켜서 써줘. 한 줄에 한 건이고, 칸은 「|」로 나눠줘. 마지막 칸의 출처에는 위 자료 번호(S1 등)와 쪽수를 적어줘.');
    L.push('[신규 기능]');
    L.push('- 브랜드 | 새로 도입된 기능 | 출처(예: S1 p.3)');
    L.push('[Sales Point]');
    L.push('- 브랜드 | 영업·홍보에서 내세운 강점 | 출처');
    L.push('[스펙 비교]');
    L.push('- 브랜드 | 스펙 항목 | 값(단위 포함) | 출처');
    L.push('[한줄 요약]');
    L.push('- 전체를 3줄 이내로 정리');
    return L.join('\n');
  }
  var BM_SECTIONS = { '신규기능': 'features', 'salespoint': 'sales', '스펙비교': 'specs', '한줄요약': 'summary' };
  // AI 답변을 섹션별로 나눕니다. 출처가 없거나 없는 자료 번호를 가리키는 줄을 따로 모읍니다.
  function parseBmAnswer(text, bm) {
    var out = { features: [], sales: [], specs: [], summary: [], noSource: [], badSource: [], unparsed: [] };
    var sids = {};
    ((bm && bm.sources) || []).forEach(function (s) { sids[s.sid.toUpperCase()] = true; });
    var sec = null;
    str(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      // 섹션 머리: [신규 기능] / ## 신규 기능 / **신규 기능**
      if (/^\[[^\]|]+\]:?$/.test(line) || /^#+\s/.test(line) || /^\*\*[^*|]+\*\*:?$/.test(line)) {
        var key = norm(line.replace(/[\[\]#*:]/g, ''));
        sec = BM_SECTIONS[key] || null;
        if (!sec) out.unparsed.push(line);
        return;
      }
      if (!sec) { out.unparsed.push(line); return; }
      var body = line.replace(/^[-*•·]\s*/, '');
      if (sec === 'summary') { out.summary.push(body); return; }
      var cells = body.split('|').map(str);
      var need = sec === 'specs' ? 4 : 3;
      if (cells.length < need - 1) { out.unparsed.push(line); return; }
      var src = cells.length >= need ? cells.slice(need - 1).join(' | ') : '';
      var item = sec === 'specs' ? { brand: cells[0], item: cells[1], value: cells[2] || '', src: src }
        : { brand: cells[0], text: cells[1], src: src };
      out[sec].push(item);
      var refs = src.toUpperCase().match(/S\d+/g) || [];
      if (!src || !refs.length) out.noSource.push(line);
      else if (bm && refs.some(function (r) { return !sids[r]; })) out.badSource.push(line);
    });
    return out;
  }
  // 스펙 비교 줄을 항목 × 브랜드 표로 바꿉니다. 같은 칸에 값이 여럿이면 「 / 」로 잇습니다.
  function specTable(specRows, brands, specItems) {
    var bnames = brands.map(function (b) { return b.name; });
    specRows.forEach(function (r) { if (bnames.map(norm).indexOf(norm(r.brand)) < 0) bnames.push(r.brand); });
    var items = (specItems || []).slice();
    specRows.forEach(function (r) { if (items.map(norm).indexOf(norm(r.item)) < 0) items.push(r.item); });
    var rows = items.map(function (it) {
      return { item: it, values: bnames.map(function (bn) {
        var hits = specRows.filter(function (r) { return norm(r.item) === norm(it) && norm(r.brand) === norm(bn); });
        return hits.map(function (h) { return h.value + (h.src ? ' (' + h.src + ')' : ''); }).join(' / ');
      }) };
    });
    return { brands: bnames, rows: rows };
  }

  // ── Excel 내보내기·가져오기 (시트 = 2차원 배열) ─────────
  var SHEET = {
    models: ['기종', '담당자', '자료 저장소 링크', '메모'],
    stages: ['순서', '개발 단계'],
    schedules: ['기종', '개발 단계', '시작일', '종료일', '담당자', '완료', '메모', '상태'],
    issues: ['이슈번호', '기종', '개발 단계', '제목', '내용', '상태', '담당자', '등록일', '기한', '종결일', '조치 내용', '근거 첨부'],
    docs: ['기종', '개발 단계', '파일명', '종류', '링크(저장 위치)', '메모', '등록일'],
    bm: ['분석번호', '시장·기종', '작성일', '비교 스펙 항목', 'AI 답변 원문'],
    bmBrands: ['분석번호', '순위', '브랜드', '선정 근거'],
    bmSources: ['분석번호', '자료번호', '브랜드', '종류', '제목', '출처 주소', '파일명']
  };
  var SHEET_NAME = { models: '기종', stages: '개발단계', schedules: '일정', issues: '이슈', docs: '자료',
    bm: 'BM_분석', bmBrands: 'BM_브랜드', bmSources: 'BM_공개자료' };

  function dbToSheets(db, today) {
    var soon = db.settings && db.settings.soonDays != null ? db.settings.soonDays : 7;
    function mName(id) { var i = indexById(db.models, id); return i >= 0 ? db.models[i].name : ''; }
    function sName(id) { var i = indexById(db.stages, id); return i >= 0 ? db.stages[i].name : ''; }
    var out = {};
    out[SHEET_NAME.models] = [SHEET.models].concat(db.models.map(function (m) { return [m.name, m.owner, m.repoLink, m.memo]; }));
    out[SHEET_NAME.stages] = [SHEET.stages].concat(sortedStages(db).map(function (s) { return [s.order, s.name]; }));
    out[SHEET_NAME.schedules] = [SHEET.schedules].concat(db.schedules.map(function (s) {
      return [mName(s.modelId), sName(s.stageId), s.start, s.end, s.owner, s.done ? 'Y' : '', s.memo, today ? scheduleStatus(s, today, soon) : ''];
    }));
    out[SHEET_NAME.issues] = [SHEET.issues].concat(db.issues.map(function (x) {
      return [x.no, mName(x.modelId), sName(x.stageId), x.title, x.detail, x.status, x.owner, x.created, x.due, x.closed, x.action, evidenceText(x.evidence)];
    }));
    out[SHEET_NAME.docs] = [SHEET.docs].concat(db.docs.map(function (d) {
      return [mName(d.modelId), sName(d.stageId), d.name, d.kind, d.link, d.memo, d.added];
    }));
    var bmNo = {};
    db.bm.forEach(function (b, i) { bmNo[b.id] = 'BM-' + (i + 1); });
    out[SHEET_NAME.bm] = [SHEET.bm].concat(db.bm.map(function (b) { return [bmNo[b.id], b.market, b.created, b.specs.join('; '), b.answer]; }));
    var br = [SHEET.bmBrands], so = [SHEET.bmSources];
    db.bm.forEach(function (b) {
      b.brands.forEach(function (x) { br.push([bmNo[b.id], x.rank, x.name, x.note]); });
      b.sources.forEach(function (s) { so.push([bmNo[b.id], s.sid, s.brand, s.kind, s.title, s.url, s.file]); });
    });
    out[SHEET_NAME.bmBrands] = br;
    out[SHEET_NAME.bmSources] = so;
    return out;
  }
  // 현황표(기종 × 단계) 시트 — 내보내기 전용
  function boardSheet(db, today, soonDays) {
    var b = statusBoard(db, today, soonDays);
    var rows = [['기종', '담당자'].concat(b.stages.map(function (s) { return s.name; })).concat(['미종결 이슈', '기한 지난 이슈'])];
    b.rows.forEach(function (r) {
      rows.push([r.model.name, r.model.owner].concat(r.cells.map(function (c) {
        if (!c.schedule) return '';
        return (c.schedule.start || '?') + ' ~ ' + (c.schedule.end || '?') + ' (' + c.status + ')';
      })).concat([r.openIssues, r.overdueIssues]));
    });
    return rows;
  }

  // 이 도구가 내보낸 엑셀을 다시 읽습니다. sheets = {시트이름: 2차원 배열}
  function sheetsToDb(sheets, base) {
    var db = emptyDb();
    if (base && base.settings) db.settings = JSON.parse(JSON.stringify(base.settings));
    var report = { read: [], problems: [] };
    function rows(key) {
      var m = sheets[SHEET_NAME[key]];
      if (!m || !m.length) return null;
      var head = m[0].map(str);
      var want = SHEET[key].filter(function (h) { return h !== '상태'; });
      var missing = want.filter(function (h) { return head.indexOf(h) < 0; });
      if (missing.length) { report.problems.push(SHEET_NAME[key] + ' 시트에 열이 없습니다: ' + missing.join(', ')); return null; }
      var list = [];
      for (var i = 1; i < m.length; i++) {
        if (!(m[i] || []).some(function (c) { return str(c) !== ''; })) continue;
        var o = { _row: i + 1 };
        head.forEach(function (h, j) { o[h] = m[i][j] == null ? '' : m[i][j]; });
        list.push(o);
      }
      report.read.push(SHEET_NAME[key] + ' ' + list.length + '건');
      return list;
    }
    var r;
    if ((r = rows('stages'))) {
      r.sort(function (a, b) { return (+a['순서'] || 0) - (+b['순서'] || 0); });
      var names = r.map(function (x) { return x['개발 단계']; });
      var res = setStages(db, names);
      if (res.error) report.problems.push(res.error);
    }
    if ((r = rows('models'))) r.forEach(function (x) {
      var s = saveModel(db, { name: x['기종'], owner: x['담당자'], repoLink: x['자료 저장소 링크'], memo: x['메모'] });
      if (s.error) report.problems.push('기종 ' + x._row + '행: ' + s.error);
    });
    function modelId(name, where) {
      var m = findModelByName(db, name);
      if (!m && str(name)) { m = saveModel(db, { name: name }).model; report.problems.push(where + ': 기종 목록에 없던 「' + str(name) + '」을 추가했습니다.'); }
      return m ? m.id : '';
    }
    function stageId(name, where) {
      if (!str(name)) return '';
      var s = findStageByName(db, name);
      if (!s) { s = { id: newId('s'), name: str(name), order: db.stages.length + 1 }; db.stages.push(s); report.problems.push(where + ': 단계 목록에 없던 「' + str(name) + '」을 추가했습니다.'); }
      return s.id;
    }
    if ((r = rows('schedules'))) r.forEach(function (x) {
      var where = '일정 ' + x._row + '행';
      var mid = modelId(x['기종'], where), sid = stageId(x['개발 단계'], where);
      if (!mid || !sid) { report.problems.push(where + ': 기종·단계가 비어 건너뜀'); return; }
      var s = saveSchedule(db, mid, sid, { start: normalizeDate(x['시작일']) || x['시작일'], end: normalizeDate(x['종료일']) || x['종료일'],
        owner: x['담당자'], done: /^(y|yes|o|완료|true|1)$/i.test(str(x['완료'])), memo: x['메모'] });
      if (s.error) report.problems.push(where + ': ' + s.error);
    });
    if ((r = rows('issues'))) r.forEach(function (x) {
      var where = '이슈 ' + x._row + '행';
      var mid = modelId(x['기종'], where);
      var s = saveIssue(db, { modelId: mid, stageId: stageId(x['개발 단계'], where), title: x['제목'], detail: x['내용'],
        status: str(x['상태']), owner: x['담당자'], created: x['등록일'], due: normalizeDate(x['기한']) || x['기한'],
        closed: x['종결일'], action: x['조치 내용'], evidence: str(x['근거 첨부']) }, normalizeDate(x['등록일']) || '1970-01-01');
      if (s.error) { report.problems.push(where + ': ' + s.error); return; }
      if (/^ISS-\d+$/.test(str(x['이슈번호'])) && !db.issues.some(function (o) { return o !== s.issue && o.no === str(x['이슈번호']); })) s.issue.no = str(x['이슈번호']);
      if (s.issue.status === '종결' && !normalizeDate(x['종결일'])) s.issue.closed = '';
    });
    if ((r = rows('docs'))) r.forEach(function (x) {
      var where = '자료 ' + x._row + '행';
      var s = saveDoc(db, { modelId: modelId(x['기종'], where), stageId: stageId(x['개발 단계'], where), name: x['파일명'],
        kind: x['종류'], link: x['링크(저장 위치)'], memo: x['메모'] }, normalizeDate(x['등록일']) || '');
      if (s.error) report.problems.push(where + ': ' + s.error);
    });
    var bmMap = {};
    if ((r = rows('bm'))) r.forEach(function (x) {
      var b = newBm(x['시장·기종']);
      b.created = normalizeDate(x['작성일']);
      b.specs = str(x['비교 스펙 항목']).split(/;\s*/).map(str).filter(Boolean);
      b.answer = str(x['AI 답변 원문']);
      bmMap[str(x['분석번호'])] = b; db.bm.push(b);
    });
    if ((r = rows('bmBrands'))) r.forEach(function (x) {
      var b = bmMap[str(x['분석번호'])];
      if (b) b.brands.push({ rank: parseInt(x['순위'], 10), name: str(x['브랜드']), note: str(x['선정 근거']) });
    });
    if ((r = rows('bmSources'))) r.forEach(function (x) {
      var b = bmMap[str(x['분석번호'])];
      if (b) b.sources.push({ sid: str(x['자료번호']) || nextSourceId(b), brand: str(x['브랜드']), kind: str(x['종류']),
        title: str(x['제목']), url: str(x['출처 주소']), file: str(x['파일명']) });
    });
    if (!report.read.length) report.problems.push('이 도구가 내보낸 엑셀 형식(기종·일정·이슈 등 시트)이 아닙니다. 개발 일정 Excel 은 「일정 가져오기」 메뉴를 쓰십시오.');
    return { db: db, report: report };
  }

  // CSV (엑셀에서 한글이 깨지지 않도록 앞에 BOM)
  function toCsv(rows) {
    function cell(v) {
      var s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }

  function indexById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  var api = {
    ISSUE_STATUS: ISSUE_STATUS, SCHED_STATUS: SCHED_STATUS, BM_SOURCE_KINDS: BM_SOURCE_KINDS, IMPORT_FIELDS: IMPORT_FIELDS,
    emptyDb: emptyDb, newId: newId, ymd: ymd, daysBetween: daysBetween, normalizeDate: normalizeDate, docKind: docKind,
    findModelByName: findModelByName, findStageByName: findStageByName, sortedStages: sortedStages,
    saveModel: saveModel, deleteModel: deleteModel, modelUsage: modelUsage, setStages: setStages,
    scheduleStatus: scheduleStatus, findSchedule: findSchedule, saveSchedule: saveSchedule,
    statusBoard: statusBoard, summary: summary, ganttLayout: ganttLayout,
    guessHeaderRow: guessHeaderRow, tableFromMatrix: tableFromMatrix, guessMapping: guessMapping,
    checkMapping: checkMapping, importSchedule: importSchedule,
    nextIssueNo: nextIssueNo, issueOverdue: issueOverdue, parseEvidence: parseEvidence, evidenceText: evidenceText,
    saveIssue: saveIssue, filterIssues: filterIssues, saveDoc: saveDoc,
    newBm: newBm, nextSourceId: nextSourceId, cleanBrands: cleanBrands, buildBmPrompt: buildBmPrompt,
    parseBmAnswer: parseBmAnswer, specTable: specTable,
    dbToSheets: dbToSheets, boardSheet: boardSheet, sheetsToDb: sheetsToDb, toCsv: toCsv, indexById: indexById
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DQLogic = api;
})(typeof window !== 'undefined' ? window : this);

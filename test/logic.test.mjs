// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = '2026-09-28';
function baseDb() {
  const db = L.emptyDb();
  L.setStages(db, ['구상', '설계', '시험']);
  L.saveModel(db, { name: 'M-1', owner: '홍' });
  return db;
}
const sid = (db, n) => L.findStageByName(db, n).id;
const mid = (db, n) => L.findModelByName(db, n).id;

console.log('날짜 읽기');
test('Excel 일련번호 46293 → 2026-09-28', () => assert.equal(L.normalizeDate(46293), '2026-09-28'));
test('점·빗금·붙여쓰기 형식', () => {
  assert.equal(L.normalizeDate('2026.10.1'), '2026-10-01');
  assert.equal(L.normalizeDate('2026/10/01'), '2026-10-01');
  assert.equal(L.normalizeDate('20261001'), '2026-10-01');
  assert.equal(L.normalizeDate('2026년 10월 1일'), '2026-10-01');
});
test('없는 날짜·글자는 빈 값', () => {
  assert.equal(L.normalizeDate('2026-02-30'), '');
  assert.equal(L.normalizeDate('다음 주'), '');
  assert.equal(L.normalizeDate(12), '');
});
test('시각이 붙은 일련번호는 그날(46293.75 → 09-28, 46292.9999 → 09-28)', () => {
  assert.equal(L.normalizeDate(46293.75), '2026-09-28');
  assert.equal(L.normalizeDate(46292.9999), '2026-09-28');
});
test('Date 객체', () => assert.equal(L.normalizeDate(new Date(2026, 0, 5)), '2026-01-05'));
test('날짜 차이(윤년 포함)', () => {
  assert.equal(L.daysBetween('2028-02-28', '2028-03-01'), 2);
  assert.equal(L.daysBetween('2026-09-28', '2026-09-21'), -7);
});

console.log('일정 상태 (오늘 2026-09-28, 임박 기준 7일)');
const st = (s) => L.scheduleStatus(s, TODAY, 7);
test('완료 표시가 있으면 날짜가 지나도 완료', () => assert.equal(st({ start: '2026-01-01', end: '2026-02-01', done: true }), '완료'));
test('종료일이 어제면 지연', () => assert.equal(st({ start: '2026-09-01', end: '2026-09-27' }), '지연'));
test('종료일이 오늘이면 임박(0일 남음)', () => assert.equal(st({ start: '2026-09-01', end: '2026-09-28' }), '임박'));
test('종료일이 7일 뒤면 임박, 8일 뒤면 진행중', () => {
  assert.equal(st({ start: '2026-09-01', end: '2026-10-05' }), '임박');
  assert.equal(st({ start: '2026-09-01', end: '2026-10-06' }), '진행중');
});
test('시작 전이면 예정, 날짜가 없으면 일정 미정', () => {
  assert.equal(st({ start: '2026-10-10', end: '2026-12-01' }), '예정');
  assert.equal(st({}), '일정 미정');
});
test('임박 기준일은 설정값을 따름(3일)', () => assert.equal(L.scheduleStatus({ end: '2026-10-05' }, TODAY, 3), '예정'));

console.log('기종·단계');
test('기종명 중복(공백·대소문자 무시) 거부', () => {
  const db = baseDb();
  assert.ok(L.saveModel(db, { name: 'm -1' }).error);
  assert.equal(db.models.length, 1);
});
test('저장소 링크 저장', () => {
  const db = baseDb();
  const m = L.saveModel(db, { name: 'M-2', repoLink: '\\\\share\\a' }).model;
  assert.equal(m.repoLink, '\\\\share\\a');
});
test('단계 순서 바꾸기 — 이름이 같으면 id 유지', () => {
  const db = baseDb();
  const idSeol = sid(db, '설계');
  L.setStages(db, ['설계', '구상', '시험', '양산']);
  assert.deepEqual(L.sortedStages(db).map(s => s.name), ['설계', '구상', '시험', '양산']);
  assert.equal(sid(db, '설계'), idSeol);
});
test('일정이 걸린 단계는 뺄 수 없음', () => {
  const db = baseDb();
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '시험'), { start: '2026-10-01' });
  assert.match(L.setStages(db, ['구상', '설계']).error, /시험/);
  assert.equal(db.stages.length, 3);
});
test('기종 삭제 시 일정·이슈·자료도 함께 삭제', () => {
  const db = baseDb();
  const m = mid(db, 'M-1');
  L.saveSchedule(db, m, sid(db, '구상'), { start: '2026-10-01' });
  L.saveIssue(db, { modelId: m, title: 'a' }, TODAY);
  L.saveDoc(db, { modelId: m, name: 'a.pdf' }, TODAY);
  assert.deepEqual(L.deleteModel(db, m), { schedules: 1, issues: 1, docs: 1 });
  assert.equal(db.models.length + db.schedules.length + db.issues.length + db.docs.length, 0);
});

console.log('일정 저장');
test('종료일이 시작일보다 빠르면 거부', () => {
  const db = baseDb();
  assert.ok(L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { start: '2026-10-02', end: '2026-10-01' }).error);
});
test('같은 기종·단계는 한 줄만(두 번째 저장은 수정)', () => {
  const db = baseDb();
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { start: '2026-10-01' });
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { start: '2026-10-03', end: '2026.10.9' });
  assert.equal(db.schedules.length, 1);
  assert.equal(db.schedules[0].end, '2026-10-09');
});
test('모든 칸을 비우면 일정 삭제', () => {
  const db = baseDb();
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { start: '2026-10-01' });
  assert.equal(L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), {}).removed, true);
  assert.equal(db.schedules.length, 0);
});

console.log('일정 Excel 가져오기');
const matrix = [
  ['개발 일정표'],
  ['모델명', 'Phase', '착수일', '완료예정일', '담당'],
  ['M-1', '설계', 46293, '2026.10.30', '김'],
  ['M-9', '구상', '2026-10-01', '2026-10-10', '이'],
  ['M-1', '양산', '2026-11-01', '', ''],
  ['', '', '', '', ''],
  ['M-1', '시험', '다음 달', '', ''],
  ['M-1', '구상', '2026-10-05', '2026-10-01', '']
];
test('머리행 자동 찾기(제목 행 건너뜀)', () => assert.equal(L.guessHeaderRow(matrix), 1));
test('빈 행 제외, 원래 행 번호 유지', () => {
  const t = L.tableFromMatrix(matrix, 1);
  assert.equal(t.rows.length, 5);
  assert.equal(t.rows[4]._row, 8);
});
test('열 이름 자동 매핑(다른 이름도 동의어로)', () => {
  const map = L.guessMapping(L.tableFromMatrix(matrix, 1).headers);
  assert.deepEqual(map, { model: '모델명', stage: 'Phase', start: '착수일', end: '완료예정일', owner: '담당', memo: '' });
  assert.equal(L.checkMapping(map), '');
});
test('필수 열이 비면 안내', () => assert.match(L.checkMapping({ model: 'a', stage: '', start: 'b' }), /개발 단계/));
test('이전에 쓴 매핑을 우선', () => {
  const map = L.guessMapping(['기종', 'X단계', '시작'], { stage: 'X단계' });
  assert.equal(map.stage, 'X단계');
});
test('미리보기는 db 를 바꾸지 않음 · 옵션 없으면 새 기종·단계 건너뜀', () => {
  const db = baseDb();
  const t = L.tableFromMatrix(matrix, 1);
  const r = L.importSchedule(db, t.rows, L.guessMapping(t.headers), {}, false);
  assert.equal(db.schedules.length, 0);
  assert.equal(r.added, 1); // M-1 설계 만
  assert.deepEqual(r.skipped.map(s => s.row), [4, 5, 7, 8]);
  assert.match(r.skipped[3].reason, /종료일이 시작일보다/);
});
test('새 기종·단계 추가 옵션으로 실행', () => {
  const db = baseDb();
  const t = L.tableFromMatrix(matrix, 1);
  const r = L.importSchedule(db, t.rows, L.guessMapping(t.headers), { addModels: true, addStages: true }, true);
  assert.equal(r.added, 3);
  assert.deepEqual(r.newModels, ['M-9']);
  assert.deepEqual(r.newStages, ['양산']);
  assert.equal(L.sortedStages(db).pop().name, '양산');
  const s = L.findSchedule(db, mid(db, 'M-1'), sid(db, '설계'));
  assert.deepEqual([s.start, s.end, s.owner], ['2026-09-28', '2026-10-30', '김']);
});
test('다시 가져오면 수정 — 완료 표시와 담당자 수정은 유지', () => {
  const db = baseDb();
  const t = L.tableFromMatrix(matrix, 1);
  const map = L.guessMapping(t.headers);
  L.importSchedule(db, t.rows, map, { addModels: true, addStages: true }, true);
  const s = L.findSchedule(db, mid(db, 'M-1'), sid(db, '설계'));
  s.done = true; s.memo = '담당 메모';
  const r = L.importSchedule(db, t.rows, map, { addModels: true, addStages: true }, true);
  assert.equal(r.updated, 3);
  assert.equal(r.added, 0);
  assert.equal(s.done, true);
  assert.equal(s.memo, '담당 메모');
});

console.log('이슈 관리함');
test('이슈 번호 채번 ISS-0001, 기존 최대값 다음', () => {
  assert.equal(L.nextIssueNo([]), 'ISS-0001');
  assert.equal(L.nextIssueNo([{ no: 'ISS-0009' }, { no: 'ISS-0003' }]), 'ISS-0010');
});
test('종결하면 종결일 = 오늘, 다시 열면 비움', () => {
  const db = baseDb();
  const m = mid(db, 'M-1');
  const a = L.saveIssue(db, { modelId: m, title: '누유' }, '2026-09-20').issue;
  assert.equal(a.status, '열림');
  assert.equal(a.created, '2026-09-20');
  const b = L.saveIssue(db, Object.assign({}, a, { status: '종결' }), TODAY).issue;
  assert.equal(b.closed, TODAY);
  assert.equal(b.created, '2026-09-20');
  const c = L.saveIssue(db, Object.assign({}, b, { status: '조치중' }), TODAY).issue;
  assert.equal(c.closed, '');
  assert.equal(db.issues.length, 1);
});
test('제목·기종 없으면 거부', () => {
  const db = baseDb();
  assert.ok(L.saveIssue(db, { modelId: mid(db, 'M-1') }, TODAY).error);
  assert.ok(L.saveIssue(db, { modelId: 'nope', title: 'x' }, TODAY).error);
});
test('근거 첨부(MSG) 파일명 | 링크 나누기', () => {
  assert.deepEqual(L.parseEvidence('회의.msg | \\\\share\\a; 사진.jpg'),
    [{ name: '회의.msg', link: '\\\\share\\a' }, { name: '사진.jpg', link: '' }]);
  assert.equal(L.evidenceText([{ name: '회의.msg', link: 'x' }, { name: 'b.png', link: '' }]), '회의.msg | x; b.png');
});
test('기한 지남: 기한이 어제이고 미종결일 때만', () => {
  assert.equal(L.issueOverdue({ status: '열림', due: '2026-09-27' }, TODAY), true);
  assert.equal(L.issueOverdue({ status: '열림', due: '2026-09-28' }, TODAY), false);
  assert.equal(L.issueOverdue({ status: '종결', due: '2026-09-01' }, TODAY), false);
});
test('이슈 목록 정렬: 기한 지남 → 미종결(기한 빠른 순) → 종결', () => {
  const db = baseDb();
  const m = mid(db, 'M-1');
  L.saveIssue(db, { modelId: m, title: 'C 종결', status: '종결', due: '2026-09-01' }, TODAY);
  L.saveIssue(db, { modelId: m, title: 'B 기한없음' }, TODAY);
  L.saveIssue(db, { modelId: m, title: 'A 10월', due: '2026-10-02' }, TODAY);
  L.saveIssue(db, { modelId: m, title: 'D 지남', due: '2026-09-20' }, TODAY);
  assert.deepEqual(L.filterIssues(db, {}, TODAY).map(x => x.title[0]), ['D', 'A', 'B', 'C']);
  assert.equal(L.filterIssues(db, { status: '미종결' }, TODAY).length, 3);
  assert.equal(L.filterIssues(db, { overdueOnly: true }, TODAY).length, 1);
  assert.equal(L.filterIssues(db, { q: '10월' }, TODAY).length, 1);
});

console.log('자료 목록');
test('확장자로 종류 자동 판정', () => {
  assert.equal(L.docKind('근거.MSG'), 'Outlook MSG');
  assert.equal(L.docKind('a.pptx'), 'PPT');
  assert.equal(L.docKind('사진.jpeg'), '이미지');
  assert.equal(L.docKind('이름없음'), '');
});

console.log('현황표·간트');
test('현황표 칸 수 = 공통 단계 수, 지연·임박·기한 지난 이슈 집계', () => {
  const db = baseDb();
  const m = mid(db, 'M-1');
  L.saveSchedule(db, m, sid(db, '구상'), { start: '2026-09-01', end: '2026-09-20' });
  L.saveSchedule(db, m, sid(db, '설계'), { start: '2026-09-21', end: '2026-10-01' });
  L.saveIssue(db, { modelId: m, title: 'x', due: '2026-09-01' }, TODAY);
  const b = L.statusBoard(db, TODAY, 7);
  assert.equal(b.rows[0].cells.length, 3);
  assert.deepEqual([b.rows[0].late, b.rows[0].soon, b.rows[0].openIssues, b.rows[0].overdueIssues], [1, 1, 1, 1]);
  assert.deepEqual(L.summary(db, TODAY, 7), { models: 1, late: 1, soon: 1, openIssues: 1, overdueIssues: 1, docs: 0 });
});
test('주의 항목만 보기·담당자 거르기', () => {
  const db = baseDb();
  L.saveModel(db, { name: 'M-2', owner: '박' });
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { end: '2026-09-01' });
  assert.equal(L.statusBoard(db, TODAY, 7, { attentionOnly: true }).rows.length, 1);
  assert.equal(L.statusBoard(db, TODAY, 7, { owner: '박' }).rows[0].model.name, 'M-2');
});
test('간트 막대 위치(10일 범위)', () => {
  const g = L.ganttLayout([{ start: '2026-10-01', end: '2026-10-05' }, { start: '2026-10-06', end: '2026-10-10' }, {}], '2026-10-03');
  assert.equal(g.days, 10);
  assert.deepEqual(g.bars.map(b => [b.leftPct, b.widthPct]), [[0, 50], [50, 50]]);
  assert.equal(g.todayPct, 25);
});
test('간트: 범위 밖 오늘은 선 없음, 날짜 없으면 빈 결과', () => {
  assert.equal(L.ganttLayout([{ start: '2026-10-01', end: '2026-10-02' }], TODAY).todayPct, null);
  assert.equal(L.ganttLayout([{}], TODAY).bars.length, 0);
});

console.log('Bench Marking');
test('브랜드 순위 1~5, 겹침 거부, 빈 줄 버림', () => {
  assert.deepEqual(L.cleanBrands([{ rank: 2, name: 'B' }, { rank: 1, name: 'A' }, { rank: 3, name: '' }]).brands.map(b => b.name), ['A', 'B']);
  assert.ok(L.cleanBrands([{ rank: 6, name: 'X' }]).error);
  assert.ok(L.cleanBrands([{ rank: 1, name: 'X' }, { rank: 1, name: 'Y' }]).error);
});
test('프롬프트에 자료 번호·스펙 항목·답변 형식 포함, 요청형 문장', () => {
  const bm = L.newBm('2톤 굴착기');
  bm.brands = [{ rank: 1, name: 'A' }];
  bm.specs = ['운전중량'];
  bm.sources = [{ sid: 'S1', brand: 'A', kind: '브로셔', title: 't', url: 'https://x' }];
  const p = L.buildBmPrompt(bm);
  for (const s of ['[대상 시장·기종] 2톤 굴착기', '1위 A', 'S1 · A · 브로셔 · t · https://x', '[비교할 스펙 항목] 운전중량', '[신규 기능]', '[Sales Point]', '[스펙 비교]']) assert.ok(p.includes(s), s);
  assert.ok(p.includes('정리해줘'));
});
test('자료 번호는 S1, S2 … 이어서', () => {
  assert.equal(L.nextSourceId({ sources: [] }), 'S1');
  assert.equal(L.nextSourceId({ sources: [{ sid: 'S1' }, { sid: 'S4' }] }), 'S5');
});
test('답변 나누기 — 섹션별, 출처 없는 줄·없는 자료 번호 표시', () => {
  const bm = { sources: [{ sid: 'S1' }, { sid: 'S2' }] };
  const r = L.parseBmAnswer([
    '분석 결과입니다.',
    '## 신규 기능', '- A | 기능1 | S1 p.3', '- B | 기능2',
    '**Sales Point**', '* A | 강점 | s2 p.1',
    '[스펙 비교]', '- A | 운전중량 | 2.0 t | S1 p.6', '- B | 운전중량 | 2.1 t | S3',
    '[한줄 요약]', '- 요약 문장'
  ].join('\n'), bm);
  assert.equal(r.features.length, 2);
  assert.deepEqual(r.features[0], { brand: 'A', text: '기능1', src: 'S1 p.3' });
  assert.equal(r.sales[0].src, 's2 p.1');
  assert.deepEqual(r.specs[1], { brand: 'B', item: '운전중량', value: '2.1 t', src: 'S3' });
  assert.deepEqual(r.noSource, ['- B | 기능2']);
  assert.deepEqual(r.badSource, ['- B | 운전중량 | 2.1 t | S3']);
  assert.deepEqual(r.summary, ['요약 문장']);
  assert.deepEqual(r.unparsed, ['분석 결과입니다.']);
});
test('스펙 비교표: 항목 × 브랜드, 선정 브랜드 순서 유지', () => {
  const t = L.specTable([{ brand: 'B', item: '운전중량', value: '2.1 t', src: 'S2' }, { brand: 'A', item: '버킷', value: '0.06', src: '' }],
    [{ name: 'A' }, { name: 'B' }], ['운전중량']);
  assert.deepEqual(t.brands, ['A', 'B']);
  assert.deepEqual(t.rows, [{ item: '운전중량', values: ['', '2.1 t (S2)'] }, { item: '버킷', values: ['0.06', ''] }]);
});

console.log('엑셀 내보내기·가져오기');
test('예시 데이터 왕복: 내보낸 시트를 다시 읽으면 같은 내용', () => {
  const db = Sample.build(new Date(2026, 8, 28), L);
  const sheets = L.dbToSheets(db, TODAY);
  const back = L.sheetsToDb(sheets).db;
  const again = L.dbToSheets(back, TODAY);
  assert.deepEqual(again, sheets);
});
test('예시 데이터 구성: 기종 3 · 단계 5 · 일정 11 · 이슈 4 · 자료 4 · BM 1', () => {
  const db = Sample.build(new Date(2026, 8, 28), L);
  assert.deepEqual([db.models.length, db.stages.length, db.schedules.length, db.issues.length, db.docs.length, db.bm.length], [3, 5, 11, 4, 4, 1]);
  const s = L.summary(db, TODAY, 7);
  // 손 계산: A 시작품(+4일) 임박, B 설계(-3일, 미완료) 지연 / 이슈 A-1(기한 -2, 조치중) 기한 지남
  assert.deepEqual([s.late, s.soon, s.openIssues, s.overdueIssues], [1, 1, 3, 1]);
});
test('일정 시트 상태 열 = 오늘 기준 상태', () => {
  const db = baseDb();
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '구상'), { start: '2026-09-01', end: '2026-09-02' });
  assert.deepEqual(L.dbToSheets(db, TODAY)['일정'][1], ['M-1', '구상', '2026-09-01', '2026-09-02', '', '', '', '지연']);
});
test('다른 엑셀(이 도구 형식 아님)은 안내', () => {
  const r = L.sheetsToDb({ Sheet1: [['a', 'b'], [1, 2]] });
  assert.match(r.report.problems[0], /일정 가져오기/);
});
test('현황표 시트', () => {
  const db = baseDb();
  L.saveSchedule(db, mid(db, 'M-1'), sid(db, '설계'), { start: '2026-10-01', end: '2026-10-20' });
  const rows = L.boardSheet(db, TODAY, 7);
  assert.deepEqual(rows[0], ['기종', '담당자', '구상', '설계', '시험', '미종결 이슈', '기한 지난 이슈']);
  assert.deepEqual(rows[1], ['M-1', '홍', '', '2026-10-01 ~ 2026-10-20 (예정)', '', 0, 0]);
});
test('CSV: BOM·따옴표 처리', () => assert.equal(L.toCsv([['a,b', 'c"d'], [1, '']]), '﻿"a,b","c""d"\r\n1,'));

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));

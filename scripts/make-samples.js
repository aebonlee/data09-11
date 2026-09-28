// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js 를 2026-09-28 기준 날짜로 풀어 samples/ 에 씁니다. 모두 가상 데이터입니다.
//  - 예시데이터_개발일정.xlsx / .csv : 「일정 가져오기」 연습용(일부러 다른 열 이름: 모델명·Phase·착수일·완료예정일·담당)
//  - 예시데이터_전체.xlsx           : 「데이터 → 내보낸 엑셀 다시 가져오기」 형식
// 앱의 「예시 데이터 불러오기」는 같은 원본을 오늘 기준 날짜로 불러옵니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const base = new Date(2026, 8, 28);
const TODAY = '2026-09-28';

function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
function readBack(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const s = {};
  wb.SheetNames.forEach(n => { s[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
  return s;
}

// 1) 일정 가져오기 연습 파일
const matrix = Sample.scheduleMatrix(base);
fs.writeFileSync(path.join(out, '예시데이터_개발일정.xlsx'), book({ '개발일정(예시)': matrix }));
fs.writeFileSync(path.join(out, '예시데이터_개발일정.csv'), L.toCsv(matrix));

// 2) 전체 내보내기 형식
const db = Sample.build(base, L);
const sheets = L.dbToSheets(db, TODAY);
fs.writeFileSync(path.join(out, '예시데이터_전체.xlsx'), book(Object.assign({ '현황표': L.boardSheet(db, TODAY, 7) }, sheets)));

// 검증 ① 일정 파일을 앱과 같은 방식으로 읽어 가져오기
const m = readBack(path.join(out, '예시데이터_개발일정.xlsx'))['개발일정(예시)'];
const t = L.tableFromMatrix(m, L.guessHeaderRow(m));
const map = L.guessMapping(t.headers);
const empty = L.emptyDb();
const r = L.importSchedule(empty, t.rows, map, { addModels: true, addStages: true }, true);
if (L.checkMapping(map) || r.added !== 13 || r.skipped.length || empty.models.length !== 4 || empty.stages.length !== 5) {
  console.error('일정 파일 가져오기 확인 실패', map, r); process.exit(1);
}
// 검증 ② 전체 파일 왕복
const back = L.sheetsToDb(readBack(path.join(out, '예시데이터_전체.xlsx')));
if (JSON.stringify(L.dbToSheets(back.db, TODAY)) !== JSON.stringify(sheets)) { console.error('전체 파일 왕복 불일치'); process.exit(1); }
console.log('samples/ 생성 완료 — 일정 가져오기 13건·기종 4·단계 5, 전체 파일 왕복 일치:', back.report.read.join(', '));

/*
 * 예시 데이터(가상) — 시연용입니다. 실제 기종·일정·브랜드·스펙이 아닙니다.
 * 날짜는 불러오는 날(base) 기준으로 앞뒤 며칠씩 떨어뜨려 만들어, 언제 불러와도 지연·임박·진행 상태가 모두 보입니다.
 */
(function (root) {
  'use strict';
  var STAGES = ['구상', '설계', '시작품 제작', '시험·검증', '양산 이관'];
  var MODELS = [
    { name: '예시 기종 A (2톤급 굴착기)', owner: '예시 담당 1', repoLink: '\\\\example-share\\선행품질\\예시기종A', memo: '예시 데이터' },
    { name: '예시 기종 B (5톤급 굴착기)', owner: '예시 담당 2', repoLink: '\\\\example-share\\선행품질\\예시기종B', memo: '예시 데이터' },
    { name: '예시 기종 C (휠로더)', owner: '예시 담당 1', repoLink: '', memo: '예시 데이터 — 저장소 링크 미입력 상태' }
  ];
  // [기종, 단계, 시작 오프셋, 종료 오프셋, 담당, 완료]
  var SCHED = [
    [0, 0, -120, -90, '예시 담당 1', true], [0, 1, -89, -30, '예시 담당 1', true], [0, 2, -29, 4, '예시 담당 3', false],
    [0, 3, 5, 60, '예시 담당 3', false], [0, 4, 61, 100, '예시 담당 1', false],
    [1, 0, -60, -40, '예시 담당 2', true], [1, 1, -39, -3, '예시 담당 2', false], [1, 2, -2, 40, '예시 담당 4', false],
    [1, 3, 41, 90, '예시 담당 4', false],
    [2, 0, 10, 30, '예시 담당 1', false], [2, 1, 31, 80, '예시 담당 1', false]
  ];
  // [기종, 단계, 제목, 내용, 상태, 담당, 등록 오프셋, 기한 오프셋, 조치, 근거]
  var ISSUES = [
    [0, 2, '예시 이슈 — 시작품 용접부 치수 편차', '예시 데이터입니다. 시작품 2대 중 1대에서 도면 대비 편차가 보고된 상황을 가정했습니다.', '조치중', '예시 담당 3', -12, -2, '협력사 재측정 요청(예시)', '예시_치수편차_보고.msg | \\\\example-share\\선행품질\\예시기종A\\이슈근거'],
    [0, 2, '예시 이슈 — 유압 호스 간섭', '예시 데이터입니다.', '열림', '예시 담당 1', -3, 10, '', ''],
    [0, 1, '예시 이슈 — 설계 검토 지적 사항', '예시 데이터입니다.', '종결', '예시 담당 1', -50, -35, '도면 개정 반영(예시)', '예시_설계검토_회의록.msg'],
    [1, 1, '예시 이슈 — 설계 일정 지연 원인 확인', '예시 데이터입니다. 설계 단계 종료일이 지나 확인이 필요한 상황을 가정했습니다.', '열림', '예시 담당 2', -5, 3, '', '']
  ];
  // [기종, 단계, 파일명, 링크, 메모, 등록 오프셋]
  var DOCS = [
    [0, 1, '예시_기종A_설계검토결과.pptx', '\\\\example-share\\선행품질\\예시기종A\\설계', '예시 데이터', -40],
    [0, 2, '예시_기종A_시작품_치수측정.xlsx', '\\\\example-share\\선행품질\\예시기종A\\시작품', '예시 데이터', -10],
    [0, 2, '예시_기종A_시작품_사진.jpg', '', '예시 데이터', -9],
    [1, 1, '예시_기종B_설계사양.pdf', '\\\\example-share\\선행품질\\예시기종B', '예시 데이터', -20]
  ];
  var BM_ANSWER = [
    '[신규 기능]',
    '- 예시 브랜드 1 | (예시) 조종석 안의 신규 모니터 기능 | S1 p.2',
    '- 예시 브랜드 2 | (예시) 연비 모드 추가 | S2 p.4',
    '[Sales Point]',
    '- 예시 브랜드 1 | (예시) 좁은 현장 작업성 강조 | S1 p.1',
    '- 예시 브랜드 3 | (예시) 정비 편의성 강조',
    '[스펙 비교]',
    '- 예시 브랜드 1 | 운전중량 | (예시) 2.0 t | S1 p.6',
    '- 예시 브랜드 2 | 운전중량 | (예시) 2.1 t | S2 p.5',
    '- 예시 브랜드 1 | 버킷 용량 | (예시) 0.06 m3 | S1 p.6',
    '[한줄 요약]',
    '- 예시 데이터입니다. 실제 브로셔를 요약한 결과가 아닙니다.'
  ].join('\n');

  function shift(base, days) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }

  function build(base, L) {
    var db = L.emptyDb();
    L.setStages(db, STAGES);
    var stages = L.sortedStages(db);
    var models = MODELS.map(function (m) { return L.saveModel(db, m).model; });
    SCHED.forEach(function (s) {
      L.saveSchedule(db, models[s[0]].id, stages[s[1]].id, { start: shift(base, s[2]), end: shift(base, s[3]), owner: s[4], done: s[5], memo: '' });
    });
    ISSUES.forEach(function (x) {
      L.saveIssue(db, { modelId: models[x[0]].id, stageId: stages[x[1]].id, title: x[2], detail: x[3], status: x[4], owner: x[5],
        created: shift(base, x[6]), due: shift(base, x[7]), closed: x[4] === '종결' ? shift(base, x[7]) : '', action: x[8], evidence: x[9] }, shift(base, x[6]));
    });
    DOCS.forEach(function (d) {
      L.saveDoc(db, { modelId: models[d[0]].id, stageId: stages[d[1]].id, name: d[2], link: d[3], memo: d[4] }, shift(base, d[5]));
    });
    var bm = L.newBm('예시 시장 — 2톤급 미니 굴착기');
    bm.created = shift(base, -1);
    bm.brands = [{ rank: 1, name: '예시 브랜드 1', note: '예시 데이터 — 담당자 선정 근거를 적는 칸' },
      { rank: 2, name: '예시 브랜드 2', note: '' }, { rank: 3, name: '예시 브랜드 3', note: '' }];
    bm.specs = ['운전중량', '버킷 용량', '엔진 출력'];
    bm.sources = [
      { sid: 'S1', brand: '예시 브랜드 1', kind: '브로셔', title: '예시 브로셔(가상)', url: 'https://example.com/brochure-1.pdf', file: '예시_브랜드1_브로셔.pdf' },
      { sid: 'S2', brand: '예시 브랜드 2', kind: 'Spec sheet', title: '예시 제원표(가상)', url: 'https://example.com/spec-2.pdf', file: '' }
    ];
    bm.answer = BM_ANSWER;
    db.bm.push(bm);
    db._sample = true;
    return db;
  }

  // 일정 가져오기 연습용 표 — 일부러 이 도구와 다른 열 이름을 써서 열 이름 매핑을 시험합니다.
  function scheduleMatrix(base) {
    var m = [['예시 데이터 — 개발 기종 일정(가상). 실제 사내 일정표가 아닙니다.'],
      ['모델명', 'Phase', '착수일', '완료예정일', '담당', '비고']];
    var extra = [['예시 기종 D (미니 로더)', '구상', 20, 45, '예시 담당 5', '가져오기로 새로 들어오는 기종'],
      ['예시 기종 D (미니 로더)', '설계', 46, 110, '예시 담당 5', '']];
    SCHED.forEach(function (s) { m.push([MODELS[s[0]].name, STAGES[s[1]], shift(base, s[2]), shift(base, s[3]), s[4], '']); });
    extra.forEach(function (e) { m.push([e[0], e[1], shift(base, e[2]), shift(base, e[3]), e[4], e[5]]); });
    return m;
  }

  var api = { build: build, scheduleMatrix: scheduleMatrix, STAGES: STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DQSample = api;
})(typeof window !== 'undefined' ? window : this);

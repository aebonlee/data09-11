-- ============================================================================
-- 로컬 검증 전용 — data09-11 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② 남의 기종에 일정·이슈·자료를 끼워 넣을 수 없는가
--  ③ anon 은 아무것도 못 하는가 ④ CHECK·UNIQUE·외래키가 걸리는가
--  ⑤ 함수 권한에 PUBLIC·anon 이 남지 않았는가 를 잰다.
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 지정한 SQLSTATE 로 실패해야 통과. 현재 역할(invoker)로 실행된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-11 — 소유자 격리 · 기종 소속 · anon 차단 · 제약 · 함수 권한'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A 가 기종·단계·일정·이슈·자료·BM 을 등록한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.workspace (soon_days) values (7);
  insert into public.model (model_id, name, owner) values ('m-a1', '예시 기종 A', '담당 1');
  insert into public.stage (stage_id, name, sort_order) values ('s-1', '구상', 1), ('s-2', '설계', 2);
  insert into public.schedule (schedule_id, model_id, stage_id, start_date, end_date, owner)
  values ('p-1', 'm-a1', 's-1', '2026-09-01', '2026-09-30', '담당 1');
  insert into public.issue (issue_id, no, model_id, stage_id, title, evidence)
  values ('i-1', 'ISS-0001', 'm-a1', 's-1', '치수 편차', '[{"name":"보고.msg","link":""}]');
  insert into public.doc (doc_id, model_id, stage_id, name, kind) values ('d-1', 'm-a1', 's-2', '설계검토.pptx', 'PPT');
  insert into public.bm (bm_id, market, brands, specs)
  values ('b-1', '2톤급 미니 굴착기', '[{"rank":1,"name":"브랜드 1","note":""}]', '{운전중량}');

  perform public._assert_eq((select owner_id from public.issue where no = 'ISS-0001'),
    '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select count(*) from public.schedule), 1::bigint, 'A 는 자기 일정을 본다');
end $t$;
commit;

-- updated_at 트리거
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  update public.issue set status = '조치중' where no = 'ISS-0001';
  perform public._assert((select updated_at > created_at from public.issue where no = 'ISS-0001'),
    'updated_at 트리거가 수정 시각을 갱신한다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 지우지도, 대신 쓰지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.workspace) + (select count(*) from public.model)
    + (select count(*) from public.stage) + (select count(*) from public.schedule)
    + (select count(*) from public.issue) + (select count(*) from public.doc) + (select count(*) from public.bm),
    0::bigint, 'B 에게는 A 의 행이 7개 표 어디에서도 보이지 않는다');

  update public.issue set title = 'B가 고침' where no = 'ISS-0001';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 이슈에 닿지 않는다');

  delete from public.model;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 기종에 닿지 않는다');

  perform public._assert_raises(
    $s$insert into public.model (owner_id, model_id, name) values ('11111111-1111-1111-1111-111111111111', 'm-x', '끼워넣기')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');

  -- B 가 A 의 기종 id('m-a1')를 알아냈다고 가정한다
  perform public._assert_raises(
    $s$insert into public.issue (issue_id, no, model_id, title) values ('i-x', 'ISS-0001', 'm-a1', '남의 기종')$s$,
    '23503', 'B 는 자기 owner_id 로라도 A 의 기종에 이슈를 붙일 수 없다 (복합 외래키)');
  perform public._assert_raises(
    $s$insert into public.schedule (schedule_id, model_id, stage_id) values ('p-x', 'm-a1', 's-1')$s$,
    '23503', 'B 는 A 의 기종·단계에 일정을 붙일 수 없다');

  -- 이름 UNIQUE 는 사용자별이다 — B 도 같은 이름의 기종을 둘 수 있다
  insert into public.model (model_id, name) values ('m-a1', '예시 기종 A');
  perform public._assert_eq((select count(*) from public.model), 1::bigint,
    '같은 기종 id·이름이라도 사용자가 다르면 따로 저장된다');

  -- 자기 행을 A 에게 넘기는 UPDATE 는 WITH CHECK 가 막는다. WHERE 없이 쓴다 — WHERE 가 있으면
  -- SELECT 정책이 새 행에도 걸려 WITH CHECK 가 빠져도 막히므로 검사가 헛돈다.
  -- 다른 제약에 먼저 걸리지 않도록 A 와 겹치지 않는 행으로 잰다.
  insert into public.bm (bm_id, market) values ('b-9', 'B 시장');
  perform public._assert_raises(
    $s$update public.bm set owner_id = '11111111-1111-1111-1111-111111111111'$s$,
    '42501', 'B 는 자기 행의 owner_id 를 A 로 넘길 수 없다 (with check)');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select title from public.issue
      where owner_id = '11111111-1111-1111-1111-111111111111' and no = 'ISS-0001'),
    '치수 편차', 'B 의 시도 뒤에도 A 의 이슈는 그대로다');
  perform public._assert_eq((select count(*) from public.model
      where owner_id = '11111111-1111-1111-1111-111111111111'), 1::bigint,
    'B 의 시도 뒤에도 A 의 기종은 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['workspace','model','stage','schedule','issue','doc','bm']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises(
    $s$insert into public.model (model_id, name) values ('m-anon', 'x')$s$, '42501', 'anon 은 기종을 등록할 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null,
    '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    28::bigint, '정책 수가 28개다 (7개 표 × 4, 재실행해도 늘지 않는다)');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE · 외래키
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  perform public._assert_raises($s$insert into public.model (model_id, name) values ('m-a2', ' 예시기종 a ')$s$,
    '23505', '같은 이름(공백·대소문자 무시)의 기종은 하나만 둔다');
  perform public._assert_raises($s$insert into public.model (model_id, name) values ('m-a3', '   ')$s$,
    '23514', '기종명은 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.stage (stage_id, name, sort_order) values ('s-3', '설 계', 3)$s$,
    '23505', '같은 이름의 단계는 하나만 둔다');
  perform public._assert_raises($s$insert into public.stage (stage_id, name, sort_order) values ('s-4', '양산', 0)$s$,
    '23514', '단계 순서는 1 이상이다');
  perform public._assert_raises($s$insert into public.schedule (schedule_id, model_id, stage_id) values ('p-2', 'm-a1', 's-1')$s$,
    '23505', '한 기종·단계 칸에 일정은 하나뿐이다');
  perform public._assert_raises($s$insert into public.schedule (schedule_id, model_id, stage_id, start_date, end_date)
     values ('p-3', 'm-a1', 's-2', '2026-10-10', '2026-10-01')$s$,
    '23514', '종료일이 시작일보다 빠르면 막는다');
  perform public._assert_raises($s$insert into public.schedule (schedule_id, model_id, stage_id) values ('p-4', 'm-none', 's-1')$s$,
    '23503', '없는 기종에는 일정을 붙일 수 없다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title, status) values ('i-2', 'ISS-0002', 'm-a1', 'x', '보류')$s$,
    '23514', '이슈 상태는 열림/조치중/종결 만 받는다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title, status) values ('i-3', 'ISS-0003', 'm-a1', 'x', '종결')$s$,
    '23514', '종결 이슈에는 종결일이 있어야 한다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title, closed) values ('i-4', 'ISS-0004', 'm-a1', 'x', '2026-09-01')$s$,
    '23514', '열린 이슈에는 종결일이 없어야 한다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title) values ('i-5', 'ISS-0001', 'm-a1', 'x')$s$,
    '23505', '이슈 번호 중복은 UNIQUE 가 막는다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title) values ('i-6', 'ISSUE-7', 'm-a1', 'x')$s$,
    '23514', '이슈 번호는 ISS-0001 형식만 받는다');
  perform public._assert_raises($s$insert into public.issue (issue_id, no, model_id, title) values ('i-7', 'ISS-0007', 'm-a1', '  ')$s$,
    '23514', '이슈 제목은 비워 둘 수 없다');
  perform public._assert_raises($s$delete from public.stage where stage_id = 's-1'$s$,
    '23503', '일정·이슈가 쓰는 단계는 지울 수 없다');
  perform public._assert_raises($s$insert into public.bm (bm_id, brands) values ('b-2',
     '[{"rank":1},{"rank":2},{"rank":3},{"rank":4},{"rank":5},{"rank":6}]')$s$,
    '23514', 'Bench Marking 브랜드는 5위까지다');
  perform public._assert_raises($s$update public.workspace set soon_days = -1$s$,
    '23514', '임박 기준 일수는 0 이상이다');
end $t$;
commit;

-- 기종을 지우면 일정·이슈·자료도 함께 지워진다 (도구의 deleteModel 과 같다)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  delete from public.model where model_id = 'm-a1';
  perform public._assert_eq(
    (select count(*) from public.schedule) + (select count(*) from public.issue) + (select count(*) from public.doc),
    0::bigint, '기종을 지우면 그 일정·이슈·자료도 함께 지워진다');
  perform public._assert_eq((select count(*) from public.stage), 2::bigint, '공통 단계는 남는다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한 · search_path · 표 권한
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  -- proacl 이 NULL 이면 "기본값 = PUBLIC 에 EXECUTE" 라는 뜻이다. NULL 도 실패로 본다.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)));
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다 (예외로 둔 함수도 없음)' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and not coalesce('search_path=public' = any(p.proconfig), false);
  perform public._assert(v_bad is null,
    '모든 함수에 search_path = public 이 고정돼 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  perform public._assert(v_bad is null,
    'anon 에 표 권한이 남지 않았다 (Supabase 자동 부여를 끊었다)' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

-- 정리
delete from public.schedule;
delete from public.issue;
delete from public.doc;
delete from public.bm;
delete from public.model;
delete from public.stage;
delete from public.workspace;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;

-- ============================================================================
-- data09-11 — 선행품질 업무 지원 통합 웹 Agent
--             (과제 B 기종별 일정·이슈·자료 관리 + 과제 A Bench Marking)
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구는 브라우저 localStorage 의 `data09-11.db` 한 칸에 전부 저장합니다.
--  그 안의 배열 하나가 표 하나입니다. 필드 이름은 도구의 이름을 snake_case 로
--  그대로 옮겼고, SQL 예약어와 겹치는 것만 바꿨습니다.
--    order → sort_order · start/end → start_date/end_date
--    (각 레코드의 id 는 표의 기본키 id 와 겹치므로 model_id·stage_id·… 로 둔다.
--     modelId·stageId 참조는 같은 이름의 model_id·stage_id 칸이 된다)
--
--  표 목록
--    workspace   설정(임박 기준 일수·가져오기 열 매핑) · 예시 여부   (1인 1행)
--    model       개발 기종
--    stage       공통 개발 단계 (순서 있음)
--    schedule    기종 × 단계 일정 (한 칸에 하나)
--    issue       이슈 (ISS-0001 …) · 근거 첨부
--    doc         기종·단계별 자료 목록 (파일은 링크로만)
--    bm          과제 A Bench Marking 조사 묶음
--
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--              일정·이슈·자료가 가리키는 기종·단계는 (owner_id, model_id) 복합
--              외래키로 묶어, 남의 기종에 일정을 끼워 넣을 수 없게 합니다.
--              이 도구에는 기록성(이력·로그) 데이터가 없습니다.
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 실행 위치 가드 — 드림아이티비즈 공용 프로젝트에서는 여기서 멈춘다
--   이 파일은 접두사 없는 이름(workspace · model · set_updated_at() …)을 쓴다. 공용 프로젝트에는 같은 이름의
--   개체가 이미 있을 수 있고 다른 사이트 정책이 그것을 쓰므로, 실행하면 그 사이트들이
--   깨진다(2026-09-30 실제 사고 — data09-01 schema.sql 이 공용 프로젝트의 is_admin() 을 덮어씀).
-- ----------------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.www_profiles') is not null or to_regclass('public.user_profiles') is not null then
    raise exception '공용 프로젝트입니다 — schema.sql 은 수강생 본인 Supabase 프로젝트 전용입니다. 공용 프로젝트에서는 실행하지 마세요.';
  end if;
end;
$guard$;

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 작업 공간 — localStorage 의 settings · _sample
create table if not exists public.workspace (
  owner_id    uuid primary key default auth.uid(),
  soon_days   int not null default 7 check (soon_days between 0 and 365),   -- 종료일 며칠 전부터 「임박」
  mapping     jsonb not null default '{}'::jsonb                           -- 일정 Excel 열 이름 매핑 기억
              check (jsonb_typeof(mapping) = 'object'),
  sample      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 개발 기종 — 같은 이름(공백·대소문자 무시)의 기종은 하나만
create table if not exists public.model (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  model_id    text not null,
  name        text not null check (length(trim(name)) > 0),
  owner       text not null default '',          -- 담당자 이름 (로그인 사용자와 무관)
  repo_link   text not null default '',          -- 공유 폴더·저장소 경로
  memo        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,model_id'
  constraint model_uniq unique (owner_id, model_id)
);
create unique index if not exists model_name_uniq
  on public.model (owner_id, lower(regexp_replace(name, '\s+', '', 'g')));

-- 공통 개발 단계
create table if not exists public.stage (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  stage_id    text not null,
  name        text not null check (length(trim(name)) > 0),
  sort_order  int  not null check (sort_order >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint stage_uniq unique (owner_id, stage_id)
);
create unique index if not exists stage_name_uniq
  on public.stage (owner_id, lower(regexp_replace(name, '\s+', '', 'g')));

-- 일정 — 기종 × 단계 한 칸에 하나
create table if not exists public.schedule (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  schedule_id  text not null,
  model_id     text not null,
  stage_id     text not null,
  start_date   date,
  end_date     date,
  owner        text not null default '',
  done         boolean not null default false,
  memo         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint schedule_uniq unique (owner_id, schedule_id),
  -- 한 기종·단계에 일정이 두 줄 생기면 현황표가 어느 쪽을 볼지 모른다.
  -- upsert onConflict = 'owner_id,model_id,stage_id'
  constraint schedule_cell_uniq unique (owner_id, model_id, stage_id),
  constraint schedule_dates check (start_date is null or end_date is null or start_date <= end_date),
  -- 기종을 지우면 그 기종의 일정도 지운다(도구의 deleteModel 과 같다).
  -- 쓰는 중인 단계는 지울 수 없다(도구의 setStages 와 같다).
  constraint schedule_model_fk foreign key (owner_id, model_id)
    references public.model (owner_id, model_id) on delete cascade on update cascade,
  constraint schedule_stage_fk foreign key (owner_id, stage_id)
    references public.stage (owner_id, stage_id) on delete restrict on update cascade
);

-- 이슈
create table if not exists public.issue (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  issue_id    text not null,
  no          text not null check (no ~ '^ISS-[0-9]{4,}$'),      -- 'ISS-0001'
  model_id    text not null,
  stage_id    text,                                              -- 단계 미지정 가능
  title       text not null check (length(trim(title)) > 0),
  detail      text not null default '',
  status      text not null default '열림' check (status in ('열림', '조치중', '종결')),
  owner       text not null default '',
  created     date not null default current_date,
  due         date,
  closed      date,
  action      text not null default '',
  evidence    jsonb not null default '[]'::jsonb                 -- [{name, link}] — 메일(MSG)·파일 근거
              check (jsonb_typeof(evidence) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint issue_uniq unique (owner_id, issue_id),
  constraint issue_no_uniq unique (owner_id, no),
  -- 종결이면 종결일이 있고, 아니면 없다 (도구: 다시 열면 종결일을 비운다)
  constraint issue_closed check ((status = '종결') = (closed is not null)),
  constraint issue_model_fk foreign key (owner_id, model_id)
    references public.model (owner_id, model_id) on delete cascade on update cascade,
  constraint issue_stage_fk foreign key (owner_id, stage_id)
    references public.stage (owner_id, stage_id) on delete restrict on update cascade
);
create index if not exists issue_model_idx on public.issue (owner_id, model_id, status);

-- 자료 목록 — 파일 자체가 아니라 이름·종류·링크만 둔다
create table if not exists public.doc (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  doc_id      text not null,
  model_id    text not null,
  stage_id    text,
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default '',          -- 'PDF', 'Excel', 'Outlook MSG' …
  link        text not null default '',
  memo        text not null default '',
  added       date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint doc_uniq unique (owner_id, doc_id),
  constraint doc_model_fk foreign key (owner_id, model_id)
    references public.model (owner_id, model_id) on delete cascade on update cascade,
  constraint doc_stage_fk foreign key (owner_id, stage_id)
    references public.stage (owner_id, stage_id) on delete restrict on update cascade
);
create index if not exists doc_model_idx on public.doc (owner_id, model_id);

-- 과제 A Bench Marking — 시장·기종 하나당 한 묶음
create table if not exists public.bm (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  bm_id       text not null,
  market      text not null default '',
  created     date,
  brands      jsonb not null default '[]'::jsonb     -- [{rank 1~5, name, note}]
              check (jsonb_typeof(brands) = 'array' and jsonb_array_length(brands) <= 5),
  specs       text[] not null default '{}',          -- 비교할 스펙 항목
  sources     jsonb not null default '[]'::jsonb     -- [{sid 'S1', brand, kind, title, url, file}]
              check (jsonb_typeof(sources) = 'array'),
  answer      text not null default '',              -- 외부 AI 요약 답변 원문
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bm_uniq unique (owner_id, bm_id)
);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거
--
--  search_path 를 고정한다. 고정하지 않으면 호출자의 search_path 에 따라
--  엉뚱한 스키마의 객체를 잡을 수 있다.
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['workspace', 'model', 'stage', 'schedule', 'issue', 'doc', 'bm']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
--
--  외래키 검사는 RLS 를 거치지 않는다. 그래서 참조를 (owner_id, model_id) 로 묶어
--  「자기 owner_id 로 쓴 행은 자기 기종만 가리킬 수 있게」 했다.
-- ----------------------------------------------------------------------------

alter table public.workspace enable row level security;
alter table public.model     enable row level security;
alter table public.stage     enable row level security;
alter table public.schedule  enable row level security;
alter table public.issue     enable row level security;
alter table public.doc       enable row level security;
alter table public.bm        enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['workspace', 'model', 'stage', 'schedule', 'issue', 'doc', 'bm']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 자동으로 붙인다.
--    정책이 anon 을 막지만, 권한 자체도 끊어 두 겹으로 막는다.
-- ----------------------------------------------------------------------------

revoke all on public.workspace, public.model, public.stage, public.schedule,
              public.issue, public.doc, public.bm
  from anon;
grant select, insert, update, delete
  on public.workspace, public.model, public.stage, public.schedule,
     public.issue, public.doc, public.bm
  to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다
--       anon·authenticated·service_role 에 자동 부여
--  PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
--  (RLS 정책 식은 auth.uid() 만 쓰므로 anon 에 남겨 둘 함수가 없다.)
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수는 authenticated 를 남긴다. 직접 호출하면
-- "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================

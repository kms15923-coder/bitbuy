-- ============================================================
--  비트바이 v6 — 오늘의 롱/숏 투표
--  Supabase SQL Editor에 전부 붙여넣고 Run 한 번 (여러 번 실행해도 안전)
--  ※ update_v5.sql 을 먼저 실행해 둔 상태여야 해요.
-- ============================================================

-- 투표 하루 = 한국시간 오전 9시 ~ 다음날 오전 9시 (업비트 일봉과 같은 기준)
create or replace function public.vote_day() returns date
language sql stable as $$
  select ((now() at time zone 'Asia/Seoul') - interval '9 hours')::date;
$$;

create table if not exists public.votes (
  day        date not null default public.vote_day(),
  voter      text not null check (voter ~ '^[0-9a-f]{16}$'),
  side       text not null check (side in ('long','short')),
  created_at timestamptz not null default now(),
  primary key (day, voter)
);

alter table public.votes enable row level security;
drop policy if exists "vote once today" on public.votes;
create policy "vote once today" on public.votes for insert
  with check (day = public.vote_day());
grant insert on public.votes to anon, authenticated;
-- 개별 투표 내역은 숨기고, 합계만 공개
revoke select on public.votes from anon, authenticated;

create or replace function public.vote_counts(p_day date default null)
returns table (longs bigint, shorts bigint)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where side = 'long'), count(*) filter (where side = 'short')
  from public.votes where day = coalesce(p_day, public.vote_day());
$$;
grant execute on function public.vote_counts(date) to anon, authenticated;
grant execute on function public.vote_day() to anon, authenticated;

-- 실시간 반영은 채팅 채널로 알림을 보내는 방식이라 votes 표는 공개하지 않아요.

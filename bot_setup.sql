-- ============================================================
--  비트바이봇 설정 — Supabase SQL Editor에 전부 붙여넣고 Run 한 번
--  (여러 번 실행해도 안전합니다)
-- ============================================================

-- 1) 봇 글/댓글 표시용 칸 추가
alter table public.posts    add column if not exists is_bot  boolean not null default false;
alter table public.posts    add column if not exists bot_key text;
alter table public.posts    add column if not exists meta    jsonb;
alter table public.comments add column if not exists is_bot  boolean not null default false;
alter table public.comments add column if not exists bot_key text;
create unique index if not exists posts_bot_key_uq    on public.posts (bot_key);
create unique index if not exists comments_bot_key_uq on public.comments (bot_key);

-- 2) 일반 방문자는 봇인 척 글을 쓸 수 없게
drop policy if exists "write posts" on public.posts;
create policy "write posts" on public.posts for insert
  with check (likes = 0 and is_bot = false and bot_key is null and meta is null);
drop policy if exists "write comments" on public.comments;
create policy "write comments" on public.comments for insert
  with check (is_bot = false and bot_key is null);

-- 3) 봇 비밀키 (방문자는 볼 수 없는 곳에 저장)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.bot_secret (secret text not null);
insert into private.bot_secret (secret)
  select md5(random()::text || clock_timestamp()::text) || md5(random()::text)
  where not exists (select 1 from private.bot_secret);

-- 4) 봇 전용 글쓰기 함수 (비밀키가 맞을 때만 동작, 같은 키의 글은 한 번만)
create or replace function public.bot_post(p_secret text, p_key text, p_cat text, p_title text, p_body text, p_meta jsonb default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_secret is distinct from (select secret from private.bot_secret limit 1) then
    raise exception 'forbidden';
  end if;
  insert into public.posts (cat, title, body, nickname, is_bot, bot_key, meta)
  values (p_cat, left(p_title, 80), left(p_body, 5000), '비트바이봇', true, p_key, p_meta)
  on conflict (bot_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.bot_comment(p_secret text, p_key text, p_post bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_secret is distinct from (select secret from private.bot_secret limit 1) then
    raise exception 'forbidden';
  end if;
  insert into public.comments (post_id, body, nickname, is_bot, bot_key)
  values (p_post, left(p_body, 500), '비트바이봇', true, p_key)
  on conflict (bot_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.bot_post(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.bot_comment(text, text, bigint, text) to anon, authenticated;

-- 5) 10분마다 봇 실행 예약 (pg_cron + pg_net)
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'bitbuy-bot';
select cron.schedule(
  'bitbuy-bot',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://bitbuy-mu.vercel.app/api/bot?secret=' || (select secret from private.bot_secret limit 1),
    timeout_milliseconds := 60000
  );
  $$
);

-- 6) 지금 바로 한 번 실행 (첫 글이 바로 올라오도록)
select net.http_get(
  url := 'https://bitbuy-mu.vercel.app/api/bot?first=1&secret=' || (select secret from private.bot_secret limit 1),
  timeout_milliseconds := 60000
);

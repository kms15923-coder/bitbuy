-- ============================================================
--  비트바이 v5 설정 — Supabase SQL Editor에 전부 붙여넣고 Run 한 번
--  (봇 설정 + 채팅·게시판 개선. bot_setup.sql 을 안 했어도 이것 하나면 됩니다.
--   여러 번 실행해도 안전합니다)
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

-- ===== v5: 채팅·게시판 개선 =====

-- 5) 방문자 읽기·쓰기 권한 (이미 했어도 괜찮아요)
grant usage on schema public to anon, authenticated;
grant select, insert on public.posts, public.comments, public.chat to anon, authenticated;

-- 6) 닉네임 뒤 4자리 식별코드
alter table public.posts    add column if not exists tag text;
alter table public.comments add column if not exists tag text;
alter table public.chat     add column if not exists tag text;

-- 7) 비추천, 이미지
alter table public.posts add column if not exists dislikes integer not null default 0;
alter table public.posts add column if not exists images   text[];

-- 8) 말머리에 '인증'(수익/손실 인증) 추가
alter table public.posts drop constraint if exists posts_cat_check;
alter table public.posts add constraint posts_cat_check check (cat in ('자유','시황분석','질문','뉴스토론','인증'));

-- 9) 글쓰기 규칙 다시 정하기 (봇 사칭 금지, 이미지 4장까지, 코드 형식 확인)
drop policy if exists "write posts" on public.posts;
create policy "write posts" on public.posts for insert
  with check (likes = 0 and dislikes = 0 and is_bot = false and bot_key is null and meta is null
              and coalesce(array_length(images, 1), 0) <= 4
              and (tag is null or tag ~ '^[0-9a-f]{4}$'));
drop policy if exists "write comments" on public.comments;
create policy "write comments" on public.comments for insert
  with check (is_bot = false and bot_key is null and (tag is null or tag ~ '^[0-9a-f]{4}$'));

-- 10) 비추천 함수
create or replace function public.dislike_post(pid bigint)
returns integer language sql security definer set search_path = public as $$
  update public.posts set dislikes = dislikes + 1 where id = pid returning dislikes;
$$;
grant execute on function public.dislike_post(bigint) to anon, authenticated;
create index if not exists posts_likes_idx on public.posts (likes desc, created_at desc);

-- 11) 채팅: 봇 시스템 메시지 + 링크 금지
alter table public.chat add column if not exists is_bot  boolean not null default false;
alter table public.chat add column if not exists bot_key text;
create unique index if not exists chat_bot_key_uq on public.chat (bot_key);
drop policy if exists "write chat" on public.chat;
create policy "write chat" on public.chat for insert
  with check (is_bot = false and bot_key is null and (tag is null or tag ~ '^[0-9a-f]{4}$')
              and body !~* '(https?://|www\.|t\.me/|open\.kakao|bit\.ly|discord\.gg)');

create or replace function public.bot_chat(p_secret text, p_key text, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_secret is distinct from (select secret from private.bot_secret limit 1) then
    raise exception 'forbidden';
  end if;
  insert into public.chat (body, nickname, is_bot, bot_key)
  values (left(p_body, 300), '비트바이봇', true, p_key)
  on conflict (bot_key) do nothing
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.bot_chat(text, text, text) to anon, authenticated;

-- 12) 이미지 저장소 (공개 읽기, 누구나 업로드 · 3MB · 이미지 파일만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 3145728, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];
drop policy if exists "bitbuy upload images" on storage.objects;
create policy "bitbuy upload images" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = 'p');

-- ===== 예약 실행 =====
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 13) 게시판 봇: 10분마다
select cron.unschedule(jobid) from cron.job where jobname = 'bitbuy-bot';
select cron.schedule('bitbuy-bot', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://bitbuy-mu.vercel.app/api/bot?secret=' || (select secret from private.bot_secret limit 1),
    timeout_milliseconds := 60000);
$$);

-- 14) 채팅 급등락 봇: 1분마다
select cron.unschedule(jobid) from cron.job where jobname = 'bitbuy-chatbot';
select cron.schedule('bitbuy-chatbot', '* * * * *', $$
  select net.http_get(
    url := 'https://bitbuy-mu.vercel.app/api/bot?mode=chat&secret=' || (select secret from private.bot_secret limit 1),
    timeout_milliseconds := 30000);
$$);

-- 15) 지금 바로 한 번 실행 (첫 브리핑·뉴스 글)
select net.http_get(
  url := 'https://bitbuy-mu.vercel.app/api/bot?first=1&secret=' || (select secret from private.bot_secret limit 1),
  timeout_milliseconds := 60000);

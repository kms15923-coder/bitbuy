-- ============================================================
--  비트바이 데이터베이스 설정
--  Supabase 대시보드 > SQL Editor > New query 에 이 파일 내용을
--  전부 붙여넣고 [Run]을 한 번 누르면 끝입니다.
-- ============================================================

-- 1) 게시글
create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  cat         text not null check (cat in ('자유','시황분석','질문','뉴스토론')),
  title       text not null check (char_length(title) between 2 and 80),
  body        text not null check (char_length(body) between 2 and 5000),
  nickname    text not null check (char_length(nickname) between 2 and 12),
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- 2) 댓글
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.posts(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  nickname    text not null check (char_length(nickname) between 2 and 12),
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- 3) 채팅
create table if not exists public.chat (
  id          bigint generated always as identity primary key,
  body        text not null check (char_length(body) between 1 and 300),
  nickname    text not null check (char_length(nickname) between 2 and 12),
  created_at  timestamptz not null default now()
);
create index if not exists chat_created_idx on public.chat (created_at desc);

-- 4) 보안 규칙: 누구나 읽기·쓰기 가능, 수정·삭제는 관리자(대시보드)만
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.chat     enable row level security;

drop policy if exists "read posts" on public.posts;
drop policy if exists "write posts" on public.posts;
create policy "read posts"  on public.posts for select using (true);
create policy "write posts" on public.posts for insert with check (likes = 0);

drop policy if exists "read comments" on public.comments;
drop policy if exists "write comments" on public.comments;
create policy "read comments"  on public.comments for select using (true);
create policy "write comments" on public.comments for insert with check (true);

drop policy if exists "read chat" on public.chat;
drop policy if exists "write chat" on public.chat;
create policy "read chat"  on public.chat for select using (true);
create policy "write chat" on public.chat for insert with check (true);

-- 5) 추천 +1 (추천 수만 바꿀 수 있는 안전한 함수)
create or replace function public.like_post(pid bigint)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.posts set likes = likes + 1 where id = pid returning likes;
$$;
grant execute on function public.like_post(bigint) to anon, authenticated;

-- 6) 채팅은 최근 2,000개만 남기고 자동 정리 (무료 용량 절약)
create or replace function public.trim_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat where id < new.id - 2000;
  return null;
end;
$$;
drop trigger if exists trim_chat_trg on public.chat;
create trigger trim_chat_trg after insert on public.chat
  for each row execute function public.trim_chat();

-- 7) 실시간 기능 켜기 (새 글·새 채팅이 바로 보이게)
do $$
begin
  begin alter publication supabase_realtime add table public.chat;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.posts; exception when duplicate_object then null; end;
end $$;

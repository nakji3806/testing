-- Supabase SQL Editor에서 한 번 실행하세요.
-- 모든 행과 문제 사진은 로그인한 본인만 읽고 쓸 수 있습니다.

create table if not exists public.solutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  explanation text not null,
  image_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists solutions_user_id_created_at_idx
  on public.solutions (user_id, created_at desc);

alter table public.solutions enable row level security;

create policy "Users can read their solutions"
on public.solutions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their solutions"
on public.solutions for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can delete their solutions"
on public.solutions for delete to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('problem-images', 'problem-images', false)
on conflict (id) do nothing;

-- 파일 경로는 반드시 "사용자 UUID/파일명" 형태여야 합니다.
create policy "Users can read their problem images"
on storage.objects for select to authenticated
using (bucket_id = 'problem-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Users can upload their problem images"
on storage.objects for insert to authenticated
with check (bucket_id = 'problem-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Users can delete their problem images"
on storage.objects for delete to authenticated
using (bucket_id = 'problem-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

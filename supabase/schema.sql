-- Hozy 手記 —— 瀏覽計數器
--
-- 在 Supabase 主控台的 SQL Editor 執行一次即可。
--
-- 設計重點：anon 角色不能直接寫這張表，只能透過 increment_views() 這個
-- SECURITY DEFINER 函式 +1。這樣前端拿到 anon key 也只能做「加一」這件事，
-- 不能任意竄改數字或刪資料。

create table if not exists public.page_views (
  slug        text primary key,
  views       bigint      not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.page_views enable row level security;

-- 讀取開放給所有人（首頁要撈全部數字填進卡片）
drop policy if exists "page_views_public_read" on public.page_views;
create policy "page_views_public_read"
  on public.page_views
  for select
  to anon, authenticated
  using (true);

-- 刻意不建立 insert / update / delete 的 policy：
-- 寫入一律走下面的函式。

create or replace function public.increment_views (page_slug text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  -- 擋掉異常的 slug，避免有人灌垃圾資料進來
  if page_slug is null or length(page_slug) = 0 or length(page_slug) > 120 then
    raise exception 'invalid slug';
  end if;

  insert into public.page_views as pv (slug, views, updated_at)
  values (page_slug, 1, now())
  on conflict (slug) do update
    set views = pv.views + 1,
        updated_at = now()
  returning pv.views into new_count;

  return new_count;
end;
$$;

revoke all on function public.increment_views(text) from public;
grant execute on function public.increment_views(text) to anon, authenticated;

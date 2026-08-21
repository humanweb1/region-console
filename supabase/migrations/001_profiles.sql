create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'viewer' check (role in ('admin', 'sub_user', 'viewer')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_created_by_idx on public.profiles(created_by);

alter table public.profiles enable row level security;

create or replace function public.is_region_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_region_admin() from public;
grant execute on function public.is_region_admin() to authenticated;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id or (select public.is_region_admin()));

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write"
on public.profiles for all
to authenticated
using ((select public.is_region_admin()))
with check ((select public.is_region_admin()));

create or replace function public.handle_region_console_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_region_console_user_created on auth.users;
create trigger on_region_console_user_created
after insert on auth.users
for each row execute procedure public.handle_region_console_user();

insert into public.profiles (id, email, name)
select id, email, coalesce(raw_user_meta_data ->> 'name', '')
from auth.users
on conflict (id) do nothing;

-- İlk yönetici hesabını oluşturduktan sonra yalnızca bir kez çalıştırın:
-- update public.profiles set role = 'admin' where email = 'SIZIN_ADMIN_EMAILINIZ';

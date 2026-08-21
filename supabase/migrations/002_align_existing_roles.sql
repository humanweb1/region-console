-- Align Region Console authorization with the existing database schema.
-- Existing schema:
--   public.profiles(id, full_name, role_id, is_active, created_at, updated_at)
--   public.roles(id, name, description, created_at)
-- This migration does not rename, drop, or recreate existing tables.

create or replace function public.is_region_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and p.is_active = true
      and lower(r.name) = 'admin'
  );
$$;

create or replace function public.can_edit_region_state()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and p.is_active = true
      and lower(r.name) in ('admin', 'sub_user', 'sub user')
  );
$$;

revoke all on function public.is_region_admin() from public;
revoke all on function public.can_edit_region_state() from public;
grant execute on function public.is_region_admin() to authenticated;
grant execute on function public.can_edit_region_state() to authenticated;

alter table if exists public.region_console_state enable row level security;

-- Replace the existing broad policies with role-aware policies.
drop policy if exists "authenticated read state" on public.region_console_state;
drop policy if exists "authenticated update state" on public.region_console_state;
drop policy if exists "region_state_authenticated_read" on public.region_console_state;
drop policy if exists "region_state_editor_insert" on public.region_console_state;
drop policy if exists "region_state_editor_update" on public.region_console_state;

create policy "region_state_authenticated_read"
on public.region_console_state
for select
to authenticated
using (true);

create policy "region_state_editor_insert"
on public.region_console_state
for insert
to authenticated
with check ((select public.can_edit_region_state()));

create policy "region_state_editor_update"
on public.region_console_state
for update
to authenticated
using ((select public.can_edit_region_state()))
with check ((select public.can_edit_region_state()));

-- No DELETE policy is intentionally created. State deletion is not a normal UI operation.

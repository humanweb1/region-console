create table if not exists public.cemeteries (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  name text not null,
  code text,
  external_id text,
  geometry jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  geometry_status text not null default 'missing',
  geometry_source text,
  geometry_version integer not null default 1,
  geometry_updated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cemeteries_geometry_status_check check (geometry_status in ('missing','available','manual','derived')),
  constraint cemeteries_geometry_source_check check (geometry_source is null or geometry_source in ('imported','manual','external','derived','catalog'))
);

create unique index if not exists cemeteries_region_name_active_uq on public.cemeteries(region_id, lower(name)) where is_active;
create index if not exists cemeteries_region_id_idx on public.cemeteries(region_id);
create index if not exists cemeteries_active_idx on public.cemeteries(is_active);

create table if not exists public.cemetery_sections (
  id uuid primary key default gen_random_uuid(),
  cemetery_id uuid not null references public.cemeteries(id) on delete cascade,
  name text not null,
  code text,
  geometry jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  geometry_status text not null default 'missing',
  geometry_source text,
  geometry_version integer not null default 1,
  geometry_updated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cemetery_sections_geometry_status_check check (geometry_status in ('missing','available','manual','derived')),
  constraint cemetery_sections_geometry_source_check check (geometry_source is null or geometry_source in ('imported','manual','external','derived','catalog'))
);

create unique index if not exists cemetery_sections_cemetery_name_active_uq on public.cemetery_sections(cemetery_id, lower(name)) where is_active;
create index if not exists cemetery_sections_cemetery_id_idx on public.cemetery_sections(cemetery_id);
create index if not exists cemetery_sections_active_idx on public.cemetery_sections(is_active);

create table if not exists public.graves (
  id uuid primary key default gen_random_uuid(),
  cemetery_id uuid not null references public.cemeteries(id) on delete cascade,
  section_id uuid references public.cemetery_sections(id) on delete set null,
  label text not null,
  code text,
  latitude double precision,
  longitude double precision,
  status text not null default 'available',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graves_status_check check (status in ('available','occupied','reserved','inactive')),
  constraint graves_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint graves_longitude_check check (longitude is null or longitude between -180 and 180)
);

create unique index if not exists graves_cemetery_label_active_uq on public.graves(cemetery_id, lower(label)) where is_active;
create index if not exists graves_cemetery_id_idx on public.graves(cemetery_id);
create index if not exists graves_section_id_idx on public.graves(section_id);
create index if not exists graves_active_idx on public.graves(is_active);

create or replace function public.touch_cemetery_location_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  if new.geometry is distinct from old.geometry then
    new.geometry_version = old.geometry_version + 1;
    new.geometry_updated_at = now();
    if new.geometry is null then new.geometry_status = 'missing';
    elsif new.geometry_status = 'missing' then new.geometry_status = 'available';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_cemetery_region_parent()
returns trigger language plpgsql security invoker set search_path = public as $$
declare parent_type text;
begin
  select type::text into parent_type from public.regions where id = new.region_id and is_active;
  if parent_type is null then raise exception 'Cemetery parent region does not exist or is inactive'; end if;
  if parent_type <> 'neighborhood' then raise exception 'Cemetery must belong to a neighborhood region'; end if;
  return new;
end;
$$;

create or replace function public.validate_grave_section_cemetery()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.section_id is not null and not exists (
    select 1 from public.cemetery_sections s where s.id = new.section_id and s.cemetery_id = new.cemetery_id
  ) then raise exception 'Grave section does not belong to the selected cemetery'; end if;
  return new;
end;
$$;

drop trigger if exists trg_cemeteries_updated_at on public.cemeteries;
create trigger trg_cemeteries_updated_at before update on public.cemeteries for each row execute function public.touch_cemetery_location_updated_at();
drop trigger if exists trg_cemetery_sections_updated_at on public.cemetery_sections;
create trigger trg_cemetery_sections_updated_at before update on public.cemetery_sections for each row execute function public.touch_cemetery_location_updated_at();
drop trigger if exists trg_validate_cemetery_region_parent on public.cemeteries;
create trigger trg_validate_cemetery_region_parent before insert or update of region_id on public.cemeteries for each row execute function public.validate_cemetery_region_parent();
drop trigger if exists trg_validate_grave_section_cemetery on public.graves;
create trigger trg_validate_grave_section_cemetery before insert or update of cemetery_id, section_id on public.graves for each row execute function public.validate_grave_section_cemetery();

alter table public.cemeteries enable row level security;
alter table public.cemetery_sections enable row level security;
alter table public.graves enable row level security;

drop policy if exists "cemeteries view by permission" on public.cemeteries;
create policy "cemeteries view by permission" on public.cemeteries for select using (has_permission('cemeteries.view') and user_has_region_scope(region_id));
drop policy if exists "cemeteries manage by permission" on public.cemeteries;
create policy "cemeteries manage by permission" on public.cemeteries for all using (has_permission('cemeteries.manage') and user_has_region_scope(region_id)) with check (has_permission('cemeteries.manage') and user_has_region_scope(region_id));

drop policy if exists "cemetery sections view by permission" on public.cemetery_sections;
create policy "cemetery sections view by permission" on public.cemetery_sections for select using (has_permission('cemetery_sections.view') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id)));
drop policy if exists "cemetery sections manage by permission" on public.cemetery_sections;
create policy "cemetery sections manage by permission" on public.cemetery_sections for all using (has_permission('cemetery_sections.manage') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id))) with check (has_permission('cemetery_sections.manage') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id)));

drop policy if exists "graves view by permission" on public.graves;
create policy "graves view by permission" on public.graves for select using (has_permission('graves.view') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id)));
drop policy if exists "graves manage by permission" on public.graves;
create policy "graves manage by permission" on public.graves for all using (has_permission('graves.manage') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id))) with check (has_permission('graves.manage') and exists (select 1 from public.cemeteries c where c.id = cemetery_id and user_has_region_scope(c.region_id)));

grant select, insert, update, delete on public.cemeteries to authenticated;
grant select, insert, update, delete on public.cemetery_sections to authenticated;
grant select, insert, update, delete on public.graves to authenticated;

insert into public.role_permissions(role_id, permission)
select r.id, p.permission
from public.roles r
cross join (values
  ('cemeteries.view'), ('cemeteries.manage'),
  ('cemetery_sections.view'), ('cemetery_sections.manage'),
  ('graves.view'), ('graves.manage')
) p(permission)
where r.name in ('super_admin','admin','manager')
on conflict (role_id, permission) do nothing;

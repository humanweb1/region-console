-- Enforce region scopes on role assignment and application-state edits.
-- Also repair the Greece catalog hierarchy and remove an unused duplicate Turkey root.

create or replace function public.resolve_role_scope_region_id(
  p_external_id text,
  p_type text,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if nullif(btrim(p_external_id), '') is not null then
    select r.id into result_id
    from public.regions r
    where r.external_id = p_external_id
      and r.type::text = lower(p_type)
    order by r.created_at
    limit 1;
  end if;

  if result_id is null and nullif(btrim(p_name), '') is not null then
    select r.id into result_id
    from public.regions r
    where r.type::text = lower(p_type)
      and lower(trim(r.name)) = lower(trim(p_name))
    order by r.id
    limit 1;
  end if;

  return result_id;
end;
$$;

revoke all on function public.resolve_role_scope_region_id(text,text,text) from public, anon, authenticated;
grant execute on function public.resolve_role_scope_region_id(text,text,text) to service_role;

-- The imported application state uses country-e2... for Greece while the
-- catalog has the stable imported country id. Rebuild those parent links from
-- the application's canonical hierarchy before enforcing scope checks.
update public.regions province
set parent_id = greece.id,
    updated_at = now()
from public.regions greece
where province.type::text = 'province'
  and greece.type::text = 'country'
  and greece.name = 'Greece'
  and province.external_id like 'import-GR%'
  and province.parent_id is distinct from greece.id;

-- Remove the unused duplicate Turkey catalog root. Its provinces are attached
-- to the canonical country-3f... root and no role scope references this row.
delete from public.regions
where id = '6b72e78c-f3a6-4787-9f41-d413d661e1af'
  and not exists (
    select 1 from public.role_scopes rs
    where rs.country_id = public.regions.id
       or rs.province_id = public.regions.id
       or rs.district_id = public.regions.id
  )
  and not exists (
    select 1 from public.regions child where child.parent_id = public.regions.id
  );

create or replace function public.admin_save_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permissions text[] default '{}',
  p_scopes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  role_row public.roles%rowtype;
  permission text;
  scope jsonb;
  country_uuid uuid;
  province_uuid uuid;
  district_uuid uuid;
  normalized_name text := lower(regexp_replace(trim(coalesce(p_name,'')),'[^a-zA-Z0-9_]+','_','g'));
begin
  if normalized_name='' or trim(coalesce(p_description,''))='' then
    raise exception 'Rol adı ve açıklaması zorunludur.' using errcode='22023';
  end if;
  if normalized_name='super_admin' then
    raise exception 'Super Admin sistem rolü değiştirilemez.' using errcode='42501';
  end if;

  if p_role_id is null then
    if exists(select 1 from public.roles where name=normalized_name) then
      raise exception 'Bu rol zaten mevcut: %',normalized_name using errcode='23505';
    end if;
    insert into public.roles(name,description)
    values(normalized_name,trim(p_description))
    returning * into role_row;
  else
    select * into role_row from public.roles where id=p_role_id for update;
    if not found then raise exception 'Rol bulunamadı.' using errcode='P0002'; end if;
    if role_row.name='super_admin' then
      raise exception 'Super Admin sistem rolü değiştirilemez.' using errcode='42501';
    end if;
    if exists(select 1 from public.roles where name=normalized_name and id<>p_role_id) then
      raise exception 'Bu rol zaten mevcut: %',normalized_name using errcode='23505';
    end if;
    update public.roles
    set name=normalized_name, description=trim(p_description)
    where id=p_role_id
    returning * into role_row;
  end if;

  delete from public.role_permissions where role_id=role_row.id;
  foreach permission in array coalesce(p_permissions,'{}') loop
    if nullif(trim(permission),'') is not null then
      insert into public.role_permissions(role_id,permission)
      values(role_row.id,trim(permission));
    end if;
  end loop;

  delete from public.role_scopes where role_id=role_row.id;
  for scope in select value from jsonb_array_elements(coalesce(p_scopes,'[]'::jsonb)) loop
    country_uuid := public.resolve_role_scope_region_id(scope->>'country_id','country',scope->>'country_name');
    province_uuid := public.resolve_role_scope_region_id(scope->>'province_id','province',scope->>'province_name');
    district_uuid := public.resolve_role_scope_region_id(scope->>'district_id','district',scope->>'district_name');

    -- Normalize the catalog hierarchy even when an imported state's parent id
    -- is from the application's JSON catalog rather than the DB UUID catalog.
    if province_uuid is not null and country_uuid is not null then
      update public.regions set parent_id=country_uuid, updated_at=now() where id=province_uuid;
    end if;
    if district_uuid is not null and province_uuid is not null then
      update public.regions set parent_id=province_uuid, updated_at=now() where id=district_uuid;
    end if;

    if country_uuid is not null or province_uuid is not null or district_uuid is not null then
      -- A non-super-admin may not grant a role more regional authority than the
      -- actor already has. This closes the privilege-escalation path where a
      -- manager with Turkey scope could assign Greece to another role.
      if not public.is_super_admin() then
        if country_uuid is not null and not public.has_region_scope(country_uuid) then
          raise exception 'Seçilen ülke kapsamınız dışında: %', coalesce(scope->>'country_name', scope->>'country_id') using errcode='42501';
        end if;
        if province_uuid is not null and not public.has_region_scope(province_uuid) then
          raise exception 'Seçilen il kapsamınız dışında: %', coalesce(scope->>'province_name', scope->>'province_id') using errcode='42501';
        end if;
        if district_uuid is not null and not public.has_region_scope(district_uuid) then
          raise exception 'Seçilen ilçe kapsamınız dışında: %', coalesce(scope->>'district_name', scope->>'district_id') using errcode='42501';
        end if;
      end if;

      insert into public.role_scopes(role_id,country_id,province_id,district_id)
      values(role_row.id,country_uuid,province_uuid,district_uuid);
    end if;
  end loop;

  return jsonb_build_object('id',role_row.id,'name',role_row.name,'description',role_row.description);
end;
$$;

revoke all on function public.admin_save_role(uuid,text,text,text[],jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_role(uuid,text,text,text[],jsonb) to service_role;

create or replace function public.assert_region_console_state_scope(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_state jsonb;
  old_node jsonb;
  node jsonb;
  node_type text;
  external_id text;
  catalog_id uuid;
begin
  if public.is_super_admin() then return; end if;

  select state into old_state
  from public.region_console_state
  where id='main';

  for node in select value from jsonb_array_elements(coalesce(p_state->'custom','[]'::jsonb)) loop
    old_node := null;
    select value into old_node
    from jsonb_array_elements(coalesce(old_state->'custom','[]'::jsonb))
    where value->>'id' = node->>'id'
    limit 1;

    -- The client sends the full state on every save. Only validate nodes that
    -- are new or actually changed in this request.
    if old_node is not null and old_node = node then
      continue;
    end if;

    node_type := lower(coalesce(node->'hierarchy'->>'type', node->>'type'));
    external_id := case
      when node_type='country' then coalesce(node->'hierarchy'->>'countryId', node->>'id')
      else node->>'id'
    end;

    catalog_id := public.resolve_role_scope_region_id(
      external_id,
      node_type,
      coalesce(node->>'name', node->'hierarchy'->>'countryName', node->'properties'->>'name')
    );

    if catalog_id is null then
      raise exception 'Bölge kapsamı doğrulanamadı: % (%)', coalesce(node->>'name',external_id), node_type using errcode='22023';
    end if;

    if not public.has_region_scope(catalog_id) then
      raise exception 'Bu bölgeyi değiştirme yetkiniz yok: %', coalesce(node->>'name',external_id) using errcode='42501';
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_region_console_state_scope(jsonb) from public, anon, authenticated;

create or replace function public.save_region_console_state(p_state jsonb,p_version bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
set statement_timeout='30s'
as $$
declare
  saved_version bigint;
  saved_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.has_permission('regions.manage') or public.has_permission('service_areas.manage') or public.has_permission('campaigns.manage')) then
    raise exception 'Insufficient permission to modify application state';
  end if;

  perform public.assert_region_console_state_scope(coalesce(p_state,'{}'::jsonb));
  perform public.sync_region_catalog(coalesce(p_state,'{}'::jsonb));

  insert into public.region_console_state(id,state,version,updated_at)
  values('main',public.region_console_compact_state(coalesce(p_state,'{}'::jsonb)),coalesce(p_version,floor(extract(epoch from clock_timestamp())*1000)::bigint),clock_timestamp())
  on conflict(id) do update set state=excluded.state,version=excluded.version,updated_at=excluded.updated_at
  returning version,updated_at into saved_version,saved_at;

  return jsonb_build_object('id','main','version',saved_version,'updated_at',saved_at);
end;
$$;

grant execute on function public.save_region_console_state(jsonb,bigint) to authenticated;

insert into supabase_migrations.schema_migrations as old
  (version,name,statements,created_by,idempotency_key,rollback)
values (
  to_char(current_timestamp,'YYYYMMDDHH24MISS'),
  'enforce_rbac_region_scopes',
  array['RBAC region scope enforcement and catalog hierarchy repair'],
  current_user,
  'enforce_rbac_region_scopes_20260902',
  null
)
on conflict (idempotency_key) do update set version=excluded.version,name=excluded.name,statements=excluded.statements,created_by=excluded.created_by;

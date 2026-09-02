-- Fix RBAC audit triggers for tables that do not have an id column,
-- keep the region catalog synchronized with the application's JSON state,
-- and make role + permissions + scopes updates atomic.

create or replace function public.audit_rbac_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_uuid uuid;
  old_row jsonb;
  new_row jsonb;
begin
  old_row := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_row := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  if tg_table_name = 'role_permissions' then
    entity_uuid := case when tg_op = 'DELETE' then old.role_id else new.role_id end;
  elsif tg_table_name in ('role_scopes','regions','profiles','roles') then
    entity_uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    entity_uuid := null;
  end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name, entity_uuid, old_row, new_row);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_profiles_changes on public.profiles;
drop trigger if exists profiles_audit_trigger on public.profiles;
create trigger audit_profiles_changes after insert or update or delete on public.profiles for each row execute function public.audit_rbac_change();
drop trigger if exists audit_role_permissions_changes on public.role_permissions;
drop trigger if exists role_permissions_audit_trigger on public.role_permissions;
create trigger audit_role_permissions_changes after insert or update or delete on public.role_permissions for each row execute function public.audit_rbac_change();
drop trigger if exists role_scopes_audit_trigger on public.role_scopes;
create trigger role_scopes_audit_trigger after insert or update or delete on public.role_scopes for each row execute function public.audit_rbac_change();
drop trigger if exists audit_roles_changes on public.roles;
drop trigger if exists roles_audit_trigger on public.roles;
create trigger audit_roles_changes after insert or update or delete on public.roles for each row execute function public.audit_rbac_change();

create or replace function public.resolve_region_catalog_id(p_external_id text,p_type text,p_name text,p_parent_external_id text default null,p_parent_type text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare result_id uuid; parent_uuid uuid;
begin
  if p_external_id is null or btrim(p_external_id)='' then return null; end if;
  select r.id into result_id from public.regions r where r.external_id=p_external_id and r.type::text=p_type order by r.created_at limit 1;
  if result_id is not null then
    if p_parent_external_id is not null then
      select r.id into parent_uuid from public.regions r where r.external_id=p_parent_external_id and (p_parent_type is null or r.type::text=p_parent_type) order by r.created_at limit 1;
      update public.regions set parent_id=coalesce(parent_uuid,parent_id),name=coalesce(nullif(btrim(p_name),''),name),is_active=true,updated_at=now() where id=result_id;
    else
      update public.regions set name=coalesce(nullif(btrim(p_name),''),name),is_active=true,updated_at=now() where id=result_id;
    end if;
    return result_id;
  end if;
  if p_parent_external_id is not null then
    select r.id into parent_uuid from public.regions r where r.external_id=p_parent_external_id and (p_parent_type is null or r.type::text=p_parent_type) order by r.created_at limit 1;
  end if;
  insert into public.regions(external_id,type,name,parent_id,is_active) values(p_external_id,p_type::region_type,coalesce(nullif(btrim(p_name),''),p_external_id),parent_uuid,true) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.sync_region_catalog(p_state jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare root jsonb; child jsonb; node jsonb; current jsonb; children jsonb; processed integer:=0; queue jsonb[]:=array[]::jsonb[]; current_parent_id text; current_parent_type text; node_id text; node_type text; node_name text;
begin
  for root in select value from jsonb_array_elements(coalesce(p_state->'countries','[]'::jsonb)) loop queue:=array_append(queue,jsonb_build_object('node',root,'parent_id',null,'parent_type',null)); end loop;
  for root in select value from jsonb_array_elements(coalesce(p_state->'custom','[]'::jsonb)) loop queue:=array_append(queue,jsonb_build_object('node',root,'parent_id',coalesce(root->'hierarchy'->>'parentId',root->>'parent_id'),'parent_type',root->'hierarchy'->>'parentType')); end loop;
  while coalesce(array_length(queue,1),0)>0 loop
    current:=queue[1]; queue:=queue[2:array_length(queue,1)]; node:=current->'node'; current_parent_id:=nullif(current->>'parent_id',''); current_parent_type:=nullif(current->>'parent_type','');
    node_id:=coalesce(node->>'id',node->'importMeta'->>'sourceId',node->'hierarchy'->>'id'); node_type:=lower(coalesce(node->'hierarchy'->>'type',node->>'type')); node_name:=coalesce(node->>'name',node->>'title',node->>'label',node_id);
    if node_id is not null and node_type in ('country','province','district','neighborhood') then
      perform public.resolve_region_catalog_id(node_id,node_type,node_name,current_parent_id,current_parent_type); processed:=processed+1;
      children:=case when jsonb_typeof(node->'provinces')='array' then node->'provinces' when jsonb_typeof(node->'children')='array' then node->'children' else '[]'::jsonb end;
      for child in select value from jsonb_array_elements(children) loop queue:=array_append(queue,jsonb_build_object('node',child,'parent_id',node_id,'parent_type',node_type)); end loop;
    end if;
  end loop;
  return processed;
end;
$$;

create or replace function public.save_region_console_state(p_state jsonb,p_version bigint)
returns jsonb language plpgsql security definer set search_path=public set statement_timeout='30s' as $$
declare saved_version bigint; saved_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.has_permission('regions.manage') or public.has_permission('service_areas.manage') or public.has_permission('campaigns.manage')) then raise exception 'Insufficient permission to modify application state'; end if;
  perform public.sync_region_catalog(coalesce(p_state,'{}'::jsonb));
  insert into public.region_console_state(id,state,version,updated_at) values('main',public.region_console_compact_state(coalesce(p_state,'{}'::jsonb)),coalesce(p_version,floor(extract(epoch from clock_timestamp())*1000)::bigint),clock_timestamp()) on conflict(id) do update set state=excluded.state,version=excluded.version,updated_at=excluded.updated_at returning version,updated_at into saved_version,saved_at;
  return jsonb_build_object('id','main','version',saved_version,'updated_at',saved_at);
end;
$$;

create or replace function public.admin_save_role(p_role_id uuid,p_name text,p_description text,p_permissions text[] default '{}',p_scopes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare role_row public.roles%rowtype; permission text; scope jsonb; country_uuid uuid; province_uuid uuid; district_uuid uuid; normalized_name text:=lower(regexp_replace(trim(coalesce(p_name,'')),'[^a-zA-Z0-9_]+','_','g'));
begin
  if normalized_name='' or trim(coalesce(p_description,''))='' then raise exception 'Rol adı ve açıklaması zorunludur.' using errcode='22023'; end if;
  if normalized_name='super_admin' then raise exception 'Super Admin sistem rolü değiştirilemez.' using errcode='42501'; end if;
  if p_role_id is null then
    if exists(select 1 from public.roles where name=normalized_name) then raise exception 'Bu rol zaten mevcut: %',normalized_name using errcode='23505'; end if;
    insert into public.roles(name,description) values(normalized_name,trim(p_description)) returning * into role_row;
  else
    select * into role_row from public.roles where id=p_role_id for update;
    if not found then raise exception 'Rol bulunamadı.' using errcode='P0002'; end if;
    if role_row.name='super_admin' then raise exception 'Super Admin sistem rolü değiştirilemez.' using errcode='42501'; end if;
    if exists(select 1 from public.roles where name=normalized_name and id<>p_role_id) then raise exception 'Bu rol zaten mevcut: %',normalized_name using errcode='23505'; end if;
    update public.roles set name=normalized_name,description=trim(p_description) where id=p_role_id returning * into role_row;
  end if;
  delete from public.role_permissions where role_id=role_row.id;
  foreach permission in array coalesce(p_permissions,'{}') loop if nullif(trim(permission),'') is not null then insert into public.role_permissions(role_id,permission) values(role_row.id,trim(permission)); end if; end loop;
  delete from public.role_scopes where role_id=role_row.id;
  for scope in select value from jsonb_array_elements(coalesce(p_scopes,'[]'::jsonb)) loop
    country_uuid:=null; province_uuid:=null; district_uuid:=null;
    if nullif(scope->>'country_id','') is not null then country_uuid:=public.resolve_region_catalog_id(scope->>'country_id','country',scope->>'country_name',null,null); end if;
    if nullif(scope->>'province_id','') is not null then province_uuid:=public.resolve_region_catalog_id(scope->>'province_id','province',scope->>'province_name',scope->>'country_id','country'); end if;
    if nullif(scope->>'district_id','') is not null then district_uuid:=public.resolve_region_catalog_id(scope->>'district_id','district',scope->>'district_name',scope->>'province_id','province'); end if;
    if country_uuid is not null or province_uuid is not null or district_uuid is not null then insert into public.role_scopes(role_id,country_id,province_id,district_id) values(role_row.id,country_uuid,province_uuid,district_uuid); end if;
  end loop;
  return jsonb_build_object('id',role_row.id,'name',role_row.name,'description',role_row.description);
end;
$$;

revoke all on function public.resolve_region_catalog_id(text,text,text,text,text) from public;
revoke all on function public.sync_region_catalog(jsonb) from public;
revoke all on function public.admin_save_role(uuid,text,text,text[],jsonb) from public;
grant execute on function public.resolve_region_catalog_id(text,text,text,text,text) to service_role;
grant execute on function public.sync_region_catalog(jsonb) to service_role;
grant execute on function public.admin_save_role(uuid,text,text,text[],jsonb) to service_role;
grant execute on function public.save_region_console_state(jsonb,bigint) to authenticated;

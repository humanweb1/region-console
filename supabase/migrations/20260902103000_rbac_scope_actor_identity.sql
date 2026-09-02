create or replace function public.is_super_admin_for(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.profiles p
    join public.roles r on r.id=p.role_id
    where p.id=p_user_id and p.is_active=true and r.name='super_admin'
  );
$$;

create or replace function public.user_has_region_scope_for(p_user_id uuid,target_region_id uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  with recursive ancestors as (
    select r.id,r.parent_id from public.regions r where r.id=target_region_id
    union all
    select r.id,r.parent_id from public.regions r join ancestors a on a.parent_id=r.id
  )
  select public.is_super_admin_for(p_user_id)
    or exists(
      select 1
      from public.role_scopes rs
      join public.profiles p on p.role_id=rs.role_id
      where p.id=p_user_id and p.is_active=true
        and (
          (rs.country_id is null and rs.province_id is null and rs.district_id is null)
          or exists(select 1 from ancestors a where a.id=rs.country_id or a.id=rs.province_id or a.id=rs.district_id)
        )
    );
$$;

revoke all on function public.is_super_admin_for(uuid) from public,anon,authenticated;
revoke all on function public.user_has_region_scope_for(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_super_admin_for(uuid) to service_role;
grant execute on function public.user_has_region_scope_for(uuid,uuid) to service_role;

drop function if exists public.admin_save_role(uuid,text,text,text[],jsonb);

create or replace function public.admin_save_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permissions text[] default '{}',
  p_scopes jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  role_row public.roles%rowtype;
  permission text;
  scope jsonb;
  country_uuid uuid;
  province_uuid uuid;
  district_uuid uuid;
  normalized_name text:=lower(regexp_replace(trim(coalesce(p_name,'')),'[^a-zA-Z0-9_]+','_','g'));
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
  foreach permission in array coalesce(p_permissions,'{}') loop
    if nullif(trim(permission),'') is not null then insert into public.role_permissions(role_id,permission) values(role_row.id,trim(permission)); end if;
  end loop;

  delete from public.role_scopes where role_id=role_row.id;
  for scope in select value from jsonb_array_elements(coalesce(p_scopes,'[]'::jsonb)) loop
    country_uuid:=public.resolve_role_scope_region_id(scope->>'country_id','country',scope->>'country_name');
    province_uuid:=public.resolve_role_scope_region_id(scope->>'province_id','province',scope->>'province_name');
    district_uuid:=public.resolve_role_scope_region_id(scope->>'district_id','district',scope->>'district_name');

    if province_uuid is not null and country_uuid is not null then update public.regions set parent_id=country_uuid,updated_at=now() where id=province_uuid; end if;
    if district_uuid is not null and province_uuid is not null then update public.regions set parent_id=province_uuid,updated_at=now() where id=district_uuid; end if;

    if country_uuid is not null or province_uuid is not null or district_uuid is not null then
      if p_actor_user_id is not null and not public.is_super_admin_for(p_actor_user_id) then
        if country_uuid is not null and not public.user_has_region_scope_for(p_actor_user_id,country_uuid) then raise exception 'Seçilen ülke kapsamınız dışında: %',coalesce(scope->>'country_name',scope->>'country_id') using errcode='42501'; end if;
        if province_uuid is not null and not public.user_has_region_scope_for(p_actor_user_id,province_uuid) then raise exception 'Seçilen il kapsamınız dışında: %',coalesce(scope->>'province_name',scope->>'province_id') using errcode='42501'; end if;
        if district_uuid is not null and not public.user_has_region_scope_for(p_actor_user_id,district_uuid) then raise exception 'Seçilen ilçe kapsamınız dışında: %',coalesce(scope->>'district_name',scope->>'district_id') using errcode='42501'; end if;
      end if;
      insert into public.role_scopes(role_id,country_id,province_id,district_id) values(role_row.id,country_uuid,province_uuid,district_uuid);
    end if;
  end loop;

  return jsonb_build_object('id',role_row.id,'name',role_row.name,'description',role_row.description);
end;
$$;

revoke all on function public.admin_save_role(uuid,text,text,text[],jsonb,uuid) from public,anon,authenticated;
grant execute on function public.admin_save_role(uuid,text,text,text[],jsonb,uuid) to service_role;

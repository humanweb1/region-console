create or replace function public.save_region_console_state(p_state jsonb, p_version bigint)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
set statement_timeout = '30s'
as $$
declare
  saved_version bigint;
  saved_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.has_permission('regions.manage')
    or public.has_permission('service_areas.manage')
    or public.has_permission('campaigns.manage')
  ) then
    raise exception 'Insufficient permission to modify application state';
  end if;

  insert into public.region_console_state (id, state, version, updated_at)
  values (
    'main',
    public.region_console_compact_state(coalesce(p_state, '{}'::jsonb)),
    coalesce(p_version, floor(extract(epoch from clock_timestamp()) * 1000)::bigint),
    clock_timestamp()
  )
  on conflict (id) do update set
    state = excluded.state,
    version = excluded.version,
    updated_at = excluded.updated_at
  returning version, updated_at into saved_version, saved_at;

  return jsonb_build_object(
    'id', 'main',
    'version', saved_version,
    'updated_at', saved_at
  );
end;
$$;

create table if not exists public.region_console_history (
  id bigint generated always as identity primary key,
  label text not null,
  created_at timestamptz not null default clock_timestamp(),
  entry jsonb not null default '{}'::jsonb
);

create index if not exists region_console_history_created_at_idx
  on public.region_console_history (created_at desc, id desc);

alter table public.region_console_history enable row level security;

drop policy if exists "region_console_history_select_authenticated" on public.region_console_history;
create policy "region_console_history_select_authenticated"
  on public.region_console_history for select to authenticated using (true);

drop policy if exists "region_console_history_insert_authenticated" on public.region_console_history;
create policy "region_console_history_insert_authenticated"
  on public.region_console_history for insert to authenticated with check (true);

grant select, insert on public.region_console_history to authenticated;
grant usage, select on sequence public.region_console_history_id_seq to authenticated;

create or replace function public.save_region_console_history(p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '10s'
as $$
declare saved_id bigint; saved_at timestamptz; saved_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  saved_label := coalesce(p_entry->>'label', 'Güncelleme');
  insert into public.region_console_history(label, entry)
  values (saved_label, coalesce(p_entry, '{}'::jsonb))
  returning id, created_at into saved_id, saved_at;
  return jsonb_build_object('id', saved_id, 'created_at', saved_at, 'label', saved_label, 'entry', coalesce(p_entry, '{}'::jsonb));
end;
$$;

grant execute on function public.save_region_console_history(jsonb) to authenticated;

create or replace function public.load_region_console_history(p_limit integer default 5, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public set statement_timeout = '10s'
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'label', h.label, 'createdAt', h.created_at, 'entry', h.entry) order by h.id desc), '[]'::jsonb)
  into result
  from (
    select id, label, created_at, entry
    from public.region_console_history
    order by id desc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    offset greatest(0, coalesce(p_offset, 0))
  ) h;
  return result;
end;
$$;

grant execute on function public.load_region_console_history(integer, integer) to authenticated;

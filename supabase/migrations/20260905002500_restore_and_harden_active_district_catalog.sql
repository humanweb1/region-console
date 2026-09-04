with ranked as (
  select d.id,
         row_number() over (partition by d.external_id order by d.created_at asc, d.id) as rn
  from public.regions d
  join public.regions p
    on p.id = d.parent_id
   and p.type = 'province'::public.region_type
   and p.is_active = true
  where d.type = 'district'::public.region_type
    and d.external_id like 'turkiyeapi-district-%'
)
update public.regions d
set is_active = true,
    updated_at = now()
from ranked r
where d.id = r.id
  and r.rn = 1;

create unique index if not exists regions_active_district_external_id_uidx
  on public.regions (external_id)
  where type = 'district'::public.region_type and is_active = true and external_id is not null;

create index if not exists regions_active_parent_id_idx
  on public.regions (parent_id)
  where is_active = true;

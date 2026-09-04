-- The application no longer discovers Turkish administrative data from a runtime API.
-- Keep the canonical DB catalog active so Files and RBAC use one deterministic hierarchy.

with canonical_provinces as (
  select id, name
  from public.regions
  where type='province'
    and geometry_source='catalog'
    and parent_id='3710409f-cc03-43f5-9208-b79dc8082677'
), ranked_districts as (
  select d.id,
         d.external_id,
         p.name as province_name,
         row_number() over (
           partition by d.external_id
           order by d.created_at asc, d.id asc
         ) as rn
  from public.regions d
  join public.regions p
    on p.id=d.parent_id
   and p.type='province'
  where d.type='district'
    and d.external_id like 'turkiyeapi-%'
)
update public.regions d
set is_active=true,
    parent_id=cp.id,
    updated_at=now()
from ranked_districts rd
join canonical_provinces cp
  on lower(trim(cp.name))=lower(trim(rd.province_name))
where d.id=rd.id
  and rd.rn=1;

update public.regions
set is_active=true,
    parent_id='3710409f-cc03-43f5-9208-b79dc8082677',
    updated_at=now()
where type='province'
  and geometry_source='catalog';

update public.regions
set is_active=false,
    updated_at=now()
where type='district'
  and external_id like 'turkiyeapi-%'
  and id not in (
    select id
    from (
      select d.id,
             row_number() over (
               partition by d.external_id
               order by d.created_at asc, d.id asc
             ) as rn
      from public.regions d
      where d.type='district'
        and d.external_id like 'turkiyeapi-%'
    ) x
    where rn=1
  );

-- Keep country-only role scopes on the active country row that actually owns
-- the province catalog. No generated UUIDs are embedded here.
with country_child_counts as (
  select c.id, c.name, count(p.id) as child_count
  from public.regions c
  left join public.regions p on p.parent_id = c.id and p.is_active = true
  where c.type = 'country' and c.is_active = true
  group by c.id, c.name
), canonical as (
  select distinct on (lower(trim(name))) id, name
  from country_child_counts
  order by lower(trim(name)), child_count desc, id
)
update public.role_scopes rs
set country_id = c.id
from public.regions current_country
join canonical c on lower(trim(c.name)) = lower(trim(current_country.name))
where rs.country_id = current_country.id
  and current_country.type = 'country'
  and current_country.is_active = true
  and rs.province_id is null
  and rs.district_id is null
  and current_country.id <> c.id;

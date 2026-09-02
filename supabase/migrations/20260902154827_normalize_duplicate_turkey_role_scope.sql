-- Normalize the known duplicate Turkey role scope to the country row that
-- owns the active province catalog. This migration is already applied to the
-- production database; it is kept in the repository to prevent migration drift.
update public.role_scopes rs
set country_id = canonical.id
from public.regions current_country
join public.regions canonical
  on canonical.type = 'country'
 and lower(trim(canonical.name)) = lower(trim(current_country.name))
where rs.country_id = current_country.id
  and current_country.type = 'country'
  and current_country.external_id like 'import-TR-%'
  and canonical.external_id = 'country-3fbe7ebe-b42d-4ae3-b954-41f64eebf418'
  and canonical.id <> current_country.id;

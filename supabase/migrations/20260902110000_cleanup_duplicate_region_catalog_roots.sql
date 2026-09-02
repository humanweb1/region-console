-- Keep the canonical Turkey catalog root used by the persisted region state.
-- The imported duplicate had no descendants and was not referenced by role_scopes.
delete from public.regions r
where r.type = 'country'
  and r.external_id = 'import-TR-f2ff056c-9f80-44c3-89c9-c6e53bcd29ea'
  and not exists (
    select 1 from public.role_scopes rs
    where rs.country_id = r.id or rs.province_id = r.id or rs.district_id = r.id
  );

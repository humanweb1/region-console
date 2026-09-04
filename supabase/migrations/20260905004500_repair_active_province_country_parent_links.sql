-- Restore the administrative catalog hierarchy used by RBAC scope selection.
-- Active provinces must belong to the canonical Turkey country root so
-- country -> province -> district scope validation can resolve correctly.

DO $$
DECLARE
  target_country uuid;
BEGIN
  SELECT id INTO target_country
  FROM public.regions
  WHERE type = 'country'
    AND is_active = true
    AND (
      external_id = 'country-3824f8ca-d8d4-42c9-84bf-e707fc26c3b6'
      OR name = 'Turkey'
    )
  ORDER BY
    CASE WHEN external_id = 'country-3824f8ca-d8d4-42c9-84bf-e707fc26c3b6' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF target_country IS NULL THEN
    RAISE EXCEPTION 'Active Turkey country root not found';
  END IF;

  UPDATE public.regions
  SET parent_id = target_country,
      updated_at = now()
  WHERE type = 'province'
    AND is_active = true
    AND parent_id IS DISTINCT FROM target_country;
END $$;

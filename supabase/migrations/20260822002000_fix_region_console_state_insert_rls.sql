-- region_console_state is written by the authenticated browser client via POST/upsert.
-- The existing SELECT and UPDATE policies do not authorize the INSERT half of an upsert.

GRANT SELECT, INSERT, UPDATE ON TABLE public.region_console_state TO authenticated;

DROP POLICY IF EXISTS "authenticated insert state" ON public.region_console_state;

CREATE POLICY "authenticated insert state"
ON public.region_console_state
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

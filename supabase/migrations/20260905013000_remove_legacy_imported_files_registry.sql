update public.region_console_state
set state = state - 'importedFiles',
    updated_at = now()
where id = 'main'
  and state ? 'importedFiles';

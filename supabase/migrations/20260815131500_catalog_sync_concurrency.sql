-- Two snapshots for the same source must never mutate the canonical catalogue
-- concurrently. Other sources remain independent.

create unique index if not exists catalog_sync_runs_one_running_per_source_idx
  on wacrm.catalog_sync_runs (source_id)
  where status = 'running';

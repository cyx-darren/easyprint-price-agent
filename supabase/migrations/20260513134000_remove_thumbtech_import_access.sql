drop policy if exists thumbtech_temp_anon_import_runs_select
  on public.thumbtech_product_scrape_runs;

drop policy if exists thumbtech_temp_anon_import_runs_insert
  on public.thumbtech_product_scrape_runs;

drop policy if exists thumbtech_temp_anon_import_runs_update
  on public.thumbtech_product_scrape_runs;

drop policy if exists thumbtech_temp_anon_import_products_select
  on public.thumbtech_products;

drop policy if exists thumbtech_temp_anon_import_products_insert
  on public.thumbtech_products;

drop policy if exists thumbtech_temp_anon_import_products_update
  on public.thumbtech_products;

drop policy if exists thumbtech_temp_anon_import_snapshots_select
  on public.thumbtech_product_snapshots;

drop policy if exists thumbtech_temp_anon_import_snapshots_insert
  on public.thumbtech_product_snapshots;

drop policy if exists thumbtech_temp_anon_storage_select
  on storage.objects;

drop policy if exists thumbtech_temp_anon_storage_insert
  on storage.objects;

drop policy if exists thumbtech_temp_anon_storage_update
  on storage.objects;

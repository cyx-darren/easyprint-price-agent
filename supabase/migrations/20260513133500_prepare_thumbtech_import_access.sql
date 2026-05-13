insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'thumbtech-product-images',
  'thumbtech-product-images',
  true,
  5242880,
  array['image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_product_scrape_runs' and policyname = 'thumbtech_temp_anon_import_runs_select'
  ) then
    create policy thumbtech_temp_anon_import_runs_select
      on public.thumbtech_product_scrape_runs
      for select to anon
      using (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_product_scrape_runs' and policyname = 'thumbtech_temp_anon_import_runs_insert'
  ) then
    create policy thumbtech_temp_anon_import_runs_insert
      on public.thumbtech_product_scrape_runs
      for insert to anon
      with check (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_product_scrape_runs' and policyname = 'thumbtech_temp_anon_import_runs_update'
  ) then
    create policy thumbtech_temp_anon_import_runs_update
      on public.thumbtech_product_scrape_runs
      for update to anon
      using (vendor = 'THUMBTECH')
      with check (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_products' and policyname = 'thumbtech_temp_anon_import_products_select'
  ) then
    create policy thumbtech_temp_anon_import_products_select
      on public.thumbtech_products
      for select to anon
      using (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_products' and policyname = 'thumbtech_temp_anon_import_products_insert'
  ) then
    create policy thumbtech_temp_anon_import_products_insert
      on public.thumbtech_products
      for insert to anon
      with check (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_products' and policyname = 'thumbtech_temp_anon_import_products_update'
  ) then
    create policy thumbtech_temp_anon_import_products_update
      on public.thumbtech_products
      for update to anon
      using (vendor = 'THUMBTECH')
      with check (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_product_snapshots' and policyname = 'thumbtech_temp_anon_import_snapshots_select'
  ) then
    create policy thumbtech_temp_anon_import_snapshots_select
      on public.thumbtech_product_snapshots
      for select to anon
      using (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'thumbtech_product_snapshots' and policyname = 'thumbtech_temp_anon_import_snapshots_insert'
  ) then
    create policy thumbtech_temp_anon_import_snapshots_insert
      on public.thumbtech_product_snapshots
      for insert to anon
      with check (vendor = 'THUMBTECH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'thumbtech_temp_anon_storage_select'
  ) then
    create policy thumbtech_temp_anon_storage_select
      on storage.objects
      for select to anon
      using (bucket_id = 'thumbtech-product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'thumbtech_temp_anon_storage_insert'
  ) then
    create policy thumbtech_temp_anon_storage_insert
      on storage.objects
      for insert to anon
      with check (bucket_id = 'thumbtech-product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'thumbtech_temp_anon_storage_update'
  ) then
    create policy thumbtech_temp_anon_storage_update
      on storage.objects
      for update to anon
      using (bucket_id = 'thumbtech-product-images')
      with check (bucket_id = 'thumbtech-product-images');
  end if;
end $$;

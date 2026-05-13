do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_product_import_runs' and policyname = 'ultifresh_temp_anon_import_runs_select'
  ) then
    create policy ultifresh_temp_anon_import_runs_select
      on public.ultifresh_product_import_runs
      for select to anon
      using (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_product_import_runs' and policyname = 'ultifresh_temp_anon_import_runs_insert'
  ) then
    create policy ultifresh_temp_anon_import_runs_insert
      on public.ultifresh_product_import_runs
      for insert to anon
      with check (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_product_import_runs' and policyname = 'ultifresh_temp_anon_import_runs_update'
  ) then
    create policy ultifresh_temp_anon_import_runs_update
      on public.ultifresh_product_import_runs
      for update to anon
      using (vendor = 'ULTIFRESH')
      with check (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_products' and policyname = 'ultifresh_temp_anon_import_products_select'
  ) then
    create policy ultifresh_temp_anon_import_products_select
      on public.ultifresh_products
      for select to anon
      using (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_products' and policyname = 'ultifresh_temp_anon_import_products_insert'
  ) then
    create policy ultifresh_temp_anon_import_products_insert
      on public.ultifresh_products
      for insert to anon
      with check (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_products' and policyname = 'ultifresh_temp_anon_import_products_update'
  ) then
    create policy ultifresh_temp_anon_import_products_update
      on public.ultifresh_products
      for update to anon
      using (vendor = 'ULTIFRESH')
      with check (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_product_snapshots' and policyname = 'ultifresh_temp_anon_import_snapshots_select'
  ) then
    create policy ultifresh_temp_anon_import_snapshots_select
      on public.ultifresh_product_snapshots
      for select to anon
      using (vendor = 'ULTIFRESH');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ultifresh_product_snapshots' and policyname = 'ultifresh_temp_anon_import_snapshots_insert'
  ) then
    create policy ultifresh_temp_anon_import_snapshots_insert
      on public.ultifresh_product_snapshots
      for insert to anon
      with check (vendor = 'ULTIFRESH');
  end if;
end $$;

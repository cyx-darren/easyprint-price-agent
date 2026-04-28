alter table public.sample_pricing enable row level security;

drop policy if exists sample_pricing_public_read on public.sample_pricing;

create policy sample_pricing_public_read
on public.sample_pricing
for select
to public
using (active = true);

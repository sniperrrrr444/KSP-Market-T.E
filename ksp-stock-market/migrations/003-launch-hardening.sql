-- KSP Market T/E — launch hardening migration
-- Run once in Supabase SQL Editor.
-- Uses the actual companies.price column from the current schema.

insert into public.companies
  (ticker,name,description,sector,price,previous_close,shares_outstanding,active)
values
  ('JSA','JS Aerospace',
   'Compañía aeroespacial de Kerbin centrada en vehículos, estaciones y tecnología espacial.',
   'Aeroespacial',20.00,20.00,1000000,true)
on conflict (ticker) do update set
  name=excluded.name,
  description=excluded.description,
  sector=excluded.sector,
  price=20.00,
  previous_close=20.00,
  active=true;

insert into public.price_history(company_id,price,change_pct,volume)
select c.id,20.00,0,0
from public.companies c
where c.ticker='JSA'
and not exists (
  select 1 from public.price_history h where h.company_id=c.id
);

-- Profiles are created by the database so email-confirmation mode cannot
-- leave a registered user without a profile.
create or replace function public.handle_new_ksp_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.profiles(id,username,display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ksp on auth.users;
create trigger on_auth_user_created_ksp
after insert on auth.users
for each row execute function public.handle_new_ksp_profile();

grant execute on function public.handle_new_ksp_profile() to supabase_auth_admin;

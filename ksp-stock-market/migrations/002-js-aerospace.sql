-- KSP Market T/E — add JS Aerospace (JSA)
-- Run this once in Supabase SQL Editor.
insert into public.companies(ticker,name,description,sector,price,previous_close,shares_outstanding,active)
values (
  'JSA',
  'JS Aerospace',
  'Compañía aeroespacial de Kerbin centrada en vehículos, estaciones y tecnología espacial.',
  'Aeroespacial',
  20.00,
  20.00,
  1000000,
  true
)
on conflict(ticker) do update set
  name=excluded.name,
  description=excluded.description,
  sector=excluded.sector,
  price=excluded.price,
  previous_close=excluded.previous_close,
  active=true;

-- Initial history point for the 7-day chart.
insert into public.price_history(company_id,price,change_pct,volume)
select id,20.00,0,0 from public.companies where ticker='JSA'
  and not exists (
    select 1 from public.price_history ph where ph.company_id=public.companies.id
  );

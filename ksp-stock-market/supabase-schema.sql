-- KSP Market T/E online database
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  virtual_cash numeric(18,2) not null default 10000,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  ticker text unique not null,
  name text not null,
  description text,
  sector text,
  price numeric(18,2) not null default 100,
  previous_close numeric(18,2) not null default 100,
  shares_outstanding bigint not null default 1000000,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.holdings (
  user_id uuid references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  shares bigint not null default 0,
  average_price numeric(18,2) not null default 0,
  primary key (user_id, company_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  company_id uuid references public.companies(id) not null,
  side text not null check (side in ('buy','sell')),
  quantity bigint not null check (quantity > 0),
  price numeric(18,2) not null,
  total numeric(18,2) generated always as (quantity * price) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  price numeric(18,2) not null,
  change_pct numeric(10,4) not null default 0,
  volume bigint not null default 0,
  recorded_at timestamptz not null default now()
);

create table if not exists public.market_news (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  title text not null,
  body text,
  sentiment numeric(5,2) not null default 0,
  source text default 'Discord',
  published_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  description text,
  price numeric(18,2) not null default 0,
  stock integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.holdings enable row level security;
alter table public.orders enable row level security;
alter table public.companies enable row level security;
alter table public.price_history enable row level security;
alter table public.market_news enable row level security;
alter table public.products enable row level security;

create policy if not exists "public companies read" on public.companies for select using (active = true);
create policy if not exists "public history read" on public.price_history for select using (true);
create policy if not exists "public news read" on public.market_news for select using (true);
create policy if not exists "public products read" on public.products for select using (active = true);
create policy if not exists "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy if not exists "own holdings" on public.holdings for select using (auth.uid() = user_id);
create policy if not exists "own orders" on public.orders for select using (auth.uid() = user_id);

insert into public.companies (ticker,name,description,sector,price,previous_close)
values ('KD','Kerbin Dynamics','Fabricación aeroespacial de Kerbin. Empresa ficticia de prueba.','Aeroespacial',125.40,125.40)
on conflict (ticker) do nothing;

create or replace function public.place_market_order(p_company uuid, p_side text, p_quantity bigint)
returns jsonb language plpgsql security definer as $$
declare
  c public.companies%rowtype;
  p public.profiles%rowtype;
  h public.holdings%rowtype;
  execution_price numeric(18,2);
  total numeric(18,2);
  impact numeric;
  new_price numeric(18,2);
begin
  select * into c from public.companies where id=p_company and active=true for update;
  if not found then raise exception 'Company not found'; end if;
  if p_quantity <= 0 then raise exception 'Invalid quantity'; end if;
  select * into p from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  execution_price := c.price;
  total := execution_price * p_quantity;
  select * into h from public.holdings where user_id=auth.uid() and company_id=p_company for update;
  if p_side='buy' then
    if p.virtual_cash < total then raise exception 'Insufficient cash'; end if;
    update public.profiles set virtual_cash=virtual_cash-total where id=auth.uid();
    insert into public.holdings(user_id,company_id,shares,average_price)
      values(auth.uid(),p_company,p_quantity,execution_price)
      on conflict (user_id,company_id) do update set
        average_price=((public.holdings.shares*public.holdings.average_price)+(excluded.shares*excluded.average_price))/(public.holdings.shares+excluded.shares),
        shares=public.holdings.shares+excluded.shares;
    impact := least(0.05, p_quantity::numeric / greatest(c.shares_outstanding,1) * 50);
    new_price := round(execution_price * (1 + impact),2);
  elsif p_side='sell' then
    if not found or h.shares < p_quantity then raise exception 'Insufficient shares'; end if;
    update public.profiles set virtual_cash=virtual_cash+total where id=auth.uid();
    if h.shares=p_quantity then delete from public.holdings where user_id=auth.uid() and company_id=p_company;
    else update public.holdings set shares=shares-p_quantity where user_id=auth.uid() and company_id=p_company; end if;
    impact := least(0.05, p_quantity::numeric / greatest(c.shares_outstanding,1) * 50);
    new_price := round(greatest(0.01, execution_price * (1 - impact)),2);
  else raise exception 'Invalid side'; end if;
  update public.companies set previous_close=c.price, price=new_price where id=c.id;
  insert into public.orders(user_id,company_id,side,quantity,price) values(auth.uid(),c.id,p_side,p_quantity,execution_price);
  insert into public.price_history(company_id,price,change_pct,volume) values(c.id,new_price,((new_price-c.price)/c.price)*100,p_quantity);
  return jsonb_build_object('price',execution_price,'new_price',new_price,'quantity',p_quantity,'side',p_side);
end $$;

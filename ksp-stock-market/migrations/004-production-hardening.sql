-- KSP Market T/E — production hardening 004
-- Apply once in Supabase SQL Editor.

-- Keep price_history authoritative: every real company price change is recorded once.
create or replace function public.record_company_price_history()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_history(company_id,price,change_pct,volume)
    values(
      new.id,
      new.price,
      case when old.price = 0 then 0 else ((new.price-old.price)/old.price)*100 end,
      0
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_company_price_history on public.companies;
create trigger trg_company_price_history
after update of price on public.companies
for each row execute function public.record_company_price_history();

revoke execute on function public.record_company_price_history() from public,anon,authenticated;

-- Atomic market order. The previous_close is NOT overwritten on every trade;
-- it remains the comparison baseline until a future daily-close job changes it.
create or replace function public.place_market_order(p_company uuid,p_side text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.companies%rowtype;
  p public.profiles%rowtype;
  h public.holdings%rowtype;
  execution_price numeric(18,2);
  total numeric(18,2);
  impact numeric;
  new_price numeric(18,2);
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid side'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000 then raise exception 'Invalid quantity'; end if;

  select * into c
  from public.companies
  where id=p_company and active=true
  for update;

  if not found then raise exception 'Company not found'; end if;

  select * into p
  from public.profiles
  where id=auth.uid()
  for update;

  if not found then raise exception 'Profile not found'; end if;

  execution_price:=round(c.price,2);
  total:=execution_price*p_quantity;
  select * into h
  from public.holdings
  where user_id=auth.uid() and company_id=p_company
  for update;

  impact:=least(0.05,p_quantity::numeric/greatest(c.shares_outstanding,1)*50);

  if p_side='buy' then
    if p.virtual_cash < total then raise exception 'Insufficient cash'; end if;

    update public.profiles
      set virtual_cash=virtual_cash-total
      where id=auth.uid();

    insert into public.holdings(user_id,company_id,shares,average_price)
    values(auth.uid(),p_company,p_quantity,execution_price)
    on conflict(user_id,company_id) do update
      set shares=public.holdings.shares+excluded.shares,
          average_price=round(
            ((public.holdings.shares*public.holdings.average_price)
            +(excluded.shares*excluded.average_price))
            /(public.holdings.shares+excluded.shares),2);

    new_price:=round(execution_price*(1+impact),2);
  else
    if not found or h.shares < p_quantity then raise exception 'Insufficient shares'; end if;

    update public.profiles
      set virtual_cash=virtual_cash+total
      where id=auth.uid();

    if h.shares=p_quantity then
      delete from public.holdings
      where user_id=auth.uid() and company_id=p_company;
    else
      update public.holdings
      set shares=shares-p_quantity
      where user_id=auth.uid() and company_id=p_company;
    end if;

    new_price:=round(greatest(0.01,execution_price*(1-impact)),2);
  end if;

  update public.companies
    set price=new_price
    where id=c.id;

  insert into public.orders(user_id,company_id,side,quantity,price)
  values(auth.uid(),c.id,p_side,p_quantity,execution_price);

  return jsonb_build_object(
    'price',execution_price,
    'new_price',new_price,
    'quantity',p_quantity,
    'side',p_side
  );
end;
$$;

grant execute on function public.place_market_order(uuid,text,bigint) to authenticated;

create or replace function public.place_market_order_by_ticker(p_ticker text,p_side text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select id into cid
  from public.companies
  where ticker=upper(trim(p_ticker)) and active=true
  limit 1;

  if cid is null then
    raise exception 'Company not found: %',upper(trim(p_ticker));
  end if;

  return public.place_market_order(cid,p_side,p_quantity);
end;
$$;

grant execute on function public.place_market_order_by_ticker(text,text,bigint) to authenticated;

-- Public leaderboard: only username + calculated total value are exposed.
create or replace function public.get_public_leaderboard()
returns table(username text,total_value numeric)
language sql
security definer
set search_path=''
stable
as $$
  select
    p.username,
    round(
      p.virtual_cash
      + coalesce(sum(h.shares*c.price),0),
      2
    ) as total_value
  from public.profiles p
  left join public.holdings h on h.user_id=p.id
  left join public.companies c on c.id=h.company_id
  group by p.id,p.username,p.virtual_cash
  order by total_value desc
  limit 20
$$;

revoke execute on function public.get_public_leaderboard() from public;
grant execute on function public.get_public_leaderboard() to anon,authenticated;

create index if not exists idx_price_history_company_time
  on public.price_history(company_id,recorded_at desc);

create index if not exists idx_orders_user_time
  on public.orders(user_id,created_at desc);

create index if not exists idx_holdings_company
  on public.holdings(company_id);

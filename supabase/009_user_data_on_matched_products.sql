-- Dados de utilizador (favoritos, alertas, cabaz, lojas preferidas) ligados a
-- matched_products (não a products) -- decisão tomada em 2026-08-17: products/
-- supermarket_products não tem matching verificado entre lojas (cada scrape
-- cria uma linha "products" própria, sem ligação entre a mesma referência em
-- lojas diferentes, e barcode vem sempre vazio) -- só matched_products tem o
-- sistema de confidence/match_score que resolve isso, para já só Pingo Doce x
-- Continente. As tabelas "favorites"/"price_alerts"/"baskets"/"basket_items"
-- já existentes ficam como estão (apontam para products.id, side a side) --
-- estas novas tabelas *_matched são as que a app mobile usa de facto.

create table public.user_preferred_stores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_slug text not null, -- ids do STORES em src/services/api.ts (continente, pingo_doce, lidl, ...)
  created_at timestamptz not null default now(),
  primary key (user_id, store_slug)
);

create table public.favorites_matched (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  matched_product_id uuid not null references public.matched_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, matched_product_id)
);

create table public.price_alerts_matched (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  matched_product_id uuid not null references public.matched_products(id) on delete cascade,
  target_price numeric(10,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  triggered_at timestamptz,
  unique (user_id, matched_product_id)
);

create table public.baskets_matched (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'O meu cabaz',
  created_at timestamptz not null default now()
);

create table public.basket_items_matched (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets_matched(id) on delete cascade,
  matched_product_id uuid not null references public.matched_products(id) on delete cascade,
  quantity numeric not null default 1,
  added_at timestamptz not null default now()
);

-- RLS: cada utilizador só vê/edita os seus próprios dados (auth.uid() = user_id).
alter table public.user_preferred_stores enable row level security;
alter table public.favorites_matched enable row level security;
alter table public.price_alerts_matched enable row level security;
alter table public.baskets_matched enable row level security;
alter table public.basket_items_matched enable row level security;

create policy "own preferred stores" on public.user_preferred_stores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own favorites" on public.favorites_matched
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own price alerts" on public.price_alerts_matched
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own baskets" on public.baskets_matched
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own basket items" on public.basket_items_matched
  for all using (
    exists (select 1 from public.baskets_matched b where b.id = basket_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.baskets_matched b where b.id = basket_id and b.user_id = auth.uid())
  );

-- Reports de "preco errado" feitos por utilizadores na app. Aponta para
-- supermarket_products (o preco e sempre especifico de uma loja) e opcionalmente
-- para o utilizador que reportou (ajusta a FK conforme a tabela de utilizadores
-- real da app - assume-se aqui auth.users do Supabase Auth; muda se usarem outra).

create table public.price_reports (
  id uuid primary key default gen_random_uuid(),
  supermarket_product_id uuid not null references public.supermarket_products(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  reported_price numeric(10,2),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create index price_reports_supermarket_product_id_idx on public.price_reports(supermarket_product_id);
create index price_reports_status_idx on public.price_reports(status);

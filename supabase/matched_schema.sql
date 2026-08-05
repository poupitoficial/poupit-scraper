-- Tabelas separadas das de producao (products/prices ja usadas pela app,
-- 15334 + 34184 linhas). Guardam so os pares de marca fabricante encontrados
-- pelo matching entre Pingo Doce e Continente, para validacao.

create table public.matched_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  category text,
  quantity numeric,
  quantity_unit text,
  created_at timestamptz not null default now()
);

create table public.matched_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.matched_products(id) on delete cascade,
  loja text not null check (loja in ('pingo_doce', 'continente')),
  preco numeric(10,2) not null,
  data date not null,
  created_at timestamptz not null default now()
);

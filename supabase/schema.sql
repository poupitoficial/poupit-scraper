-- Schema de referencia (ja existente no Supabase da app Poupit).
-- Mantido aqui so para documentacao / setup de um ambiente novo.

create table public.supermarkets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  active boolean not null default true
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category text not null check (category in (
    'mercearia','laticinios_ovos','talho_peixaria','frutas_legumes',
    'padaria_pastelaria','congelados','bebidas','mercearia_doce_salgada'
  )),
  unit_type text,
  unit_size numeric,
  barcode text unique,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.supermarket_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  supermarket_id uuid not null references public.supermarkets(id) on delete cascade,
  external_id text,
  url text,
  current_price numeric(10,2) check (current_price is null or current_price < 100),
  current_price_per_unit numeric(10,2),
  updated_at timestamptz not null default now(),
  unique (product_id, supermarket_id)
);

create table public.prices (
  id uuid primary key default gen_random_uuid(),
  supermarket_product_id uuid not null references public.supermarket_products(id) on delete cascade,
  price numeric(10,2) not null check (price < 100),
  price_per_unit numeric(10,2),
  captured_at timestamptz not null default now()
);

-- necessario para o scraper saber o supermarket_id do Continente
insert into public.supermarkets (name, slug)
values ('Continente', 'continente')
on conflict (slug) do nothing;

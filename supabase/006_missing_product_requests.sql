-- Pedidos de produtos em falta: quando alguem pesquisa algo que nao existe no
-- catalogo. Guarda o termo pesquisado em bruto (para agrupares pedidos parecidos
-- tu mesmo depois) mais quantas vezes foi pesquisado.

create table public.missing_product_requests (
  id uuid primary key default gen_random_uuid(),
  search_term text not null,
  user_id uuid references auth.users(id) on delete set null,
  times_requested integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'added', 'ignored')),
  created_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now()
);

create unique index missing_product_requests_search_term_idx on public.missing_product_requests (lower(search_term));

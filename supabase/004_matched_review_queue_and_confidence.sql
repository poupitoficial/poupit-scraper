-- Nivel de confianca nos matches + fila de revisao manual para os de baixa
-- confianca. Motivado por um bug real encontrado: formulas infantis NAN de
-- estagios diferentes (1/2/3/4) a serem emparelhadas por terem o mesmo peso
-- (800g) e o digito do estagio a ser ignorado no nome - essas ficaram todas
-- com score entre 0.45 e 0.571, abaixo do novo limiar de "alta confianca".
--
-- score >= 0.75  -> alta confianca, entra direto em matched_products (como ja
--                   acontecia) + fica com confidence='high'.
-- 0.45 <= score < 0.75 -> baixa confianca, vai para matched_products_review em
--                   vez de matched_products, para revisão manual.
-- (score < 0.45 continua a nao ser considerado match nenhum, como ja era.)

alter table public.matched_products add column if not exists confidence text not null default 'high'
  check (confidence in ('high', 'low'));
alter table public.matched_products add column if not exists match_score numeric;

create table if not exists public.matched_products_review (
  id uuid primary key default gen_random_uuid(),
  loja_a text not null,
  loja_b text not null,
  match_score numeric not null,
  name_a text not null,
  name_b text not null,
  brand text,
  category text,
  quantity numeric,
  quantity_unit text,
  price_a numeric(10,2) not null,
  price_b numeric(10,2) not null,
  image_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

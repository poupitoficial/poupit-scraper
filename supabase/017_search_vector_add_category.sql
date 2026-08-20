-- 017_search_vector_add_category.sql
-- Resolve a colisão do número 016: dois ficheiros (016_search_fts.sql, meu,
-- já corrido; 016_matched_products_search_vector.sql, doutra sessão, "NAO
-- APLICAR ainda") propunham a mesma coluna search_vector com expressões
-- diferentes. O segundo já foi corrido por engano mas foi NO-OP — a coluna
-- já existia (`add column if not exists`), por isso a expressão nunca
-- mudou. search_vector continua só name+brand, sem category/subcategory.
--
-- Esta migração aplica a sério a extensão pedida (juntar category +
-- subcategory), para pesquisas por categoria funcionarem
-- (ex: "limpeza casa de banho", "iogurte laticínios"). Colunas geradas não
-- dão para ALTER in-place — tem de se DROP + recriar (o índice GIN cai
-- junto e é recriado a seguir).

alter table public.matched_products drop column if exists search_vector;

alter table public.matched_products add column search_vector tsvector
  generated always as (
    to_tsvector(
      'portuguese',
      immutable_unaccent(
        coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' ||
        coalesce(category, '') || ' ' || coalesce(subcategory, '')
      )
    )
  ) stored;

create index if not exists matched_products_search_vector_idx
  on public.matched_products using gin (search_vector);

-- 018_search_vector_category_underscore_fix.sql
-- A 017 juntou category+subcategory ao search_vector mas continuavam sem
-- efeito: os slugs vêm em snake_case ("casa_limpeza",
-- "higiene_pessoal_beleza") e to_tsvector trata "_" como parte da palavra,
-- não como separador — fica UM token só ("casa_limpeza"), que nunca bate
-- com o utilizador a escrever "limpeza casa de banho" (tokens separados
-- "limpeza"/"casa"/"banho"). Confirmado ao vivo: rank_score mudou (o vetor
-- foi regenerado), mas tier continuou sempre 5 (só trigram em name/brand).
--
-- Fix: troca "_" por espaço antes do to_tsvector, para "casa_limpeza" virar
-- 2 lexemas "casa"/"limpeza" que batem com a pesquisa normal.

alter table public.matched_products drop column if exists search_vector;

alter table public.matched_products add column search_vector tsvector
  generated always as (
    to_tsvector(
      'portuguese',
      immutable_unaccent(
        coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' ||
        replace(coalesce(category, ''), '_', ' ') || ' ' ||
        replace(coalesce(subcategory, ''), '_', ' ')
      )
    )
  ) stored;

create index if not exists matched_products_search_vector_idx
  on public.matched_products using gin (search_vector);

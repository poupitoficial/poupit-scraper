-- 003_matched_prices_add_lidl.sql so adicionou 'lidl', nunca 'auchan' (o 4o
-- supermercado a fazer matching). Sem isto, os pares Continente x Auchan e
-- Pingo Doce x Auchan continuam bloqueados em matched_prices.

alter table public.matched_prices drop constraint if exists matched_prices_loja_check;
alter table public.matched_prices add constraint matched_prices_loja_check check (
  loja in ('pingo_doce', 'continente', 'lidl', 'auchan')
);

-- Adiciona 'aldi' a matched_prices_loja_check (5o supermercado a fazer
-- matching, depois de continente/pingo_doce/lidl/auchan). Sem isto os pares
-- envolvendo Aldi ficam bloqueados em matched_prices, mesmo mecanismo das
-- migrations 003 e 008.

alter table public.matched_prices drop constraint if exists matched_prices_loja_check;
alter table public.matched_prices add constraint matched_prices_loja_check check (
  loja in ('pingo_doce', 'continente', 'lidl', 'auchan', 'aldi')
);

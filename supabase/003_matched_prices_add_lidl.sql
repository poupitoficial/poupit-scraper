-- Permite 'lidl' na coluna loja de matched_prices (agora ha 3 supermercados a
-- fazer matching entre si, nao so Pingo Doce x Continente).
-- Corre isto no SQL editor do Supabase antes de inserir matches que envolvam Lidl
-- (scripts/insertMatches.mjs para os pares que incluam Lidl).

alter table public.matched_prices drop constraint if exists matched_prices_loja_check;
alter table public.matched_prices add constraint matched_prices_loja_check check (
  loja in ('pingo_doce', 'continente', 'lidl')
);

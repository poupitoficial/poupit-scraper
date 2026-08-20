-- 016_search_fts.sql
-- Pesquisa em full-text (Postgres tsvector + pg_trgm) para matched_products,
-- substitui o filtro em memória sobre 1000 linhas no cliente (SearchScreen.tsx).
--
-- Camadas de relevância (ordem pedida): nome exato > marca (todas as
-- palavras da query presentes na marca) > tokens em ordem (frase) >
-- tokens fora de ordem (AND) > trigram/fuzzy (typos).

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() não é IMMUTABLE por omissão (depende de configuração) — necessário
-- para usar em coluna gerada / índice. Wrapper IMMUTABLE explícito, dicionário fixo.
create or replace function immutable_unaccent(text)
returns text
language sql
immutable
parallel safe
as $$
  select unaccent('unaccent', $1)
$$;

alter table matched_products
  add column if not exists name_norm text
  generated always as (lower(immutable_unaccent(coalesce(name, '')))) stored;

alter table matched_products
  add column if not exists brand_norm text
  generated always as (lower(immutable_unaccent(coalesce(brand, '')))) stored;

alter table matched_products
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('portuguese', immutable_unaccent(coalesce(name, '') || ' ' || coalesce(brand, '')))
  ) stored;

create index if not exists matched_products_search_vector_idx
  on matched_products using gin (search_vector);

create index if not exists matched_products_name_trgm_idx
  on matched_products using gin (name_norm gin_trgm_ops);

create index if not exists matched_products_brand_trgm_idx
  on matched_products using gin (brand_norm gin_trgm_ops);

-- RPC principal de pesquisa. Devolve os produtos com preço mais os campos de
-- ranking (tier + score) para o cliente poder aplicar o desempate por
-- categorias de interesse DENTRO do mesmo tier, sem nunca subir acima dele.
create or replace function search_products(q text, lim int default 60)
returns table (
  id uuid,
  name text,
  brand text,
  category text,
  quantity numeric,
  quantity_unit text,
  image_url text,
  tier int,
  rank_score real
)
language sql
stable
as $$
  with query as (
    select lower(immutable_unaccent(trim(q))) as norm_q
  ),
  scored as (
    select
      mp.id,
      mp.name,
      mp.brand,
      mp.category,
      mp.quantity,
      mp.quantity_unit,
      mp.image_url,
      case
        when mp.name_norm = query.norm_q then 1
        when to_tsvector('portuguese', immutable_unaccent(coalesce(mp.brand, ''))) @@ plainto_tsquery('portuguese', query.norm_q) then 2
        when mp.search_vector @@ phraseto_tsquery('portuguese', query.norm_q) then 3
        when mp.search_vector @@ plainto_tsquery('portuguese', query.norm_q) then 4
        when greatest(similarity(mp.name_norm, query.norm_q), similarity(mp.brand_norm, query.norm_q)) > 0.25 then 5
        else null
      end as tier,
      greatest(
        ts_rank(mp.search_vector, plainto_tsquery('portuguese', query.norm_q)),
        similarity(mp.name_norm, query.norm_q),
        similarity(mp.brand_norm, query.norm_q)
      ) as rank_score
    from matched_products mp, query
    where query.norm_q <> ''
      and (
        mp.name_norm = query.norm_q
        or mp.search_vector @@ plainto_tsquery('portuguese', query.norm_q)
        or greatest(similarity(mp.name_norm, query.norm_q), similarity(mp.brand_norm, query.norm_q)) > 0.25
      )
  )
  select id, name, brand, category, quantity, quantity_unit, image_url, tier, rank_score
  from scored
  where tier is not null
  order by tier asc, rank_score desc, name asc
  limit lim;
$$;

-- RPC leve de autocomplete (sugestões enquanto o utilizador escreve, prefixo
-- de nome/marca) — usada a partir de query.length >= 2.
create or replace function search_suggestions(q text, lim int default 6)
returns table (label text, kind text)
language sql
stable
as $$
  with query as (
    select lower(immutable_unaccent(trim(q))) as norm_q
  ),
  brand_hits as (
    select distinct mp.brand as label, 1 as prio
    from matched_products mp, query
    where query.norm_q <> '' and mp.brand_norm like query.norm_q || '%'
    limit 20
  ),
  name_hits as (
    select distinct mp.name as label, 2 as prio
    from matched_products mp, query
    where query.norm_q <> '' and mp.name_norm like query.norm_q || '%'
    limit 20
  )
  select label, case when prio = 1 then 'brand' else 'product' end as kind
  from (select * from brand_hits union all select * from name_hits) all_hits
  order by prio asc, length(label) asc
  limit lim;
$$;

grant execute on function search_products(text, int) to anon, authenticated;
grant execute on function search_suggestions(text, int) to anon, authenticated;

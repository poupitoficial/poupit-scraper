-- Antes, cada corrida de insertMatchesAll.mjs identificava um matched_product
-- existente so por (name, brand) em minusculas, usando sempre o nome do lado
-- "a" do par processado. Como o mesmo produto real tem nomes ligeiramente
-- diferentes consoante a loja ("Fula Óleo Alimentar" no Continente vs "Fula
-- Óleo Alimentar" no Lidl com capitalizacao/ordem diferente), e cada par e
-- processado de forma independente, o mesmo produto real acabava em VARIAS
-- linhas de matched_products fragmentadas (uma por par de lojas em que
-- coincidia o nome), em vez de uma so linha com precos de 3+ lojas. Maximo
-- observado: 3 lojas num so produto, 97% dos produtos so com 2.
--
-- Esta tabela regista, por matched_product, exatamente que (loja, url) de
-- produto de origem o alimenta - permite ao script de merge (ver
-- scripts/insertMatchesAll.mjs) reconhecer com 100% de certeza, em corridas
-- futuras, se um par ja pertence a um produto existente (mesmo que o par
-- venha de lojas diferentes das da insercao original), e fundir clusters que
-- so se tornaram visiveis depois de mais pares serem processados.
create table public.matched_product_sources (
  product_id uuid not null references public.matched_products(id) on delete cascade,
  loja text not null,
  url text not null,
  created_at timestamptz not null default now(),
  primary key (loja, url)
);

create index matched_product_sources_product_id_idx on public.matched_product_sources (product_id);

alter table public.matched_product_sources enable row level security;
-- Sem policies: so o service role (usado pelo scraper) acede. Tabela interna
-- do pipeline de matching, a app nunca a le diretamente.

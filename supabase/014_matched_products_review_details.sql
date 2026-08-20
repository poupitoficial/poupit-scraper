-- Adiciona detalhe por-loja a matched_products_review, para dar contexto
-- suficiente na revisao manual sem ter de abrir o site (preco/unidade e URL
-- de cada lado, quantidade separada por lado em vez de um valor unico
-- fundido). Motivado pelo caso real das bolachas Gullon (Auchan "Dibus
-- Magic" vs Aldi "Hookies") - o preco/kg (11.77 vs 5.86) foi o que revelou
-- que sao produtos diferentes, mas so estava disponivel abrindo os sites.

alter table public.matched_products_review add column if not exists price_per_unit_a numeric;
alter table public.matched_products_review add column if not exists price_per_unit_b numeric;
alter table public.matched_products_review add column if not exists quantity_a numeric;
alter table public.matched_products_review add column if not exists quantity_unit_a text;
alter table public.matched_products_review add column if not exists quantity_b numeric;
alter table public.matched_products_review add column if not exists quantity_unit_b text;
alter table public.matched_products_review add column if not exists url_a text;
alter table public.matched_products_review add column if not exists url_b text;
alter table public.matched_products_review add column if not exists image_url_a text;
alter table public.matched_products_review add column if not exists image_url_b text;

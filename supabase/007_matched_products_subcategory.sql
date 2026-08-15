-- matched_products tem category mas nao subcategory (a coluna existe em products
-- desde a migration 002, nunca foi propagada para matched_products). Sem isto os
-- chips de subcategoria no ecrã "Categoria Aberta" da app nao funcionam.
--
-- IMPORTANTE: isto por si so nao chega. As migrations 003 e 004 (ja escritas,
-- ainda por correr) tambem sao precisas:
--   003_matched_prices_add_lidl.sql -> sem isto, matched_prices continua a so
--     aceitar loja='pingo_doce'/'continente'; qualquer match com Lidl ou Auchan
--     falha a inserir o preco.
--   004_matched_review_queue_and_confidence.sql -> sem isto, matched_products
--     nao tem as colunas confidence/match_score que scripts/insertMatchesAll.mjs
--     ja usa, e a tabela matched_products_review (fila de baixa confianca) nao
--     existe.
-- Corre as 3 (003, 004, 007) antes de eu voltar a correr o matching.

alter table public.matched_products add column if not exists subcategory text;

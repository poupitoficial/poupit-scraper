-- Permite confidence='manual' em matched_products - usado por
-- scripts/reviewMatches.mjs quando uma linha da fila de baixa confianca
-- (matched_products_review) e aprovada a mao por um humano, para distinguir
-- de 'high' (aprovado automaticamente por score >= 0.75). 'low' nunca chega
-- a ser gravado em matched_products (fica em matched_products_review), mas
-- mantem-se no enum por compatibilidade com dados/codigo existente.

alter table public.matched_products drop constraint if exists matched_products_confidence_check;
alter table public.matched_products add constraint matched_products_confidence_check check (
  confidence in ('high', 'low', 'manual')
);

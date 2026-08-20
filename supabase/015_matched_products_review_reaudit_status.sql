-- Adiciona 'reaudit_pending' a matched_products_review.status - usado quando
-- um match ja aprovado (confidence=high) e reauditado contra um criterio
-- novo (ex. preco/unidade em frutas_legumes) e falha, mas nao deve ser
-- apagado - fica marcado para revisao manual em vez de 'pending' normal,
-- para se distinguir de matches novos nunca vistos.

alter table public.matched_products_review drop constraint if exists matched_products_review_status_check;
alter table public.matched_products_review add constraint matched_products_review_status_check check (
  status in ('pending', 'approved', 'rejected', 'reaudit_pending')
);

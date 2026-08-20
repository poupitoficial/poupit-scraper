-- 019_basket_history_and_weekly_summary.sql
-- "Resumo semanal" (notificação) não tinha emissor: BasketHistoryContext.tsx só existia em
-- memória no telemóvel (nem AsyncStorage — perdia-se ao fechar a app), nunca sincronizava com o
-- Supabase. Sem histórico no servidor não há como somar "quanto poupaste esta semana" fora do
-- próprio telemóvel. Esta migração cria a tabela server-side; o envio real fica no novo script
-- sendWeeklySummary.js (mesmo padrão do sendPriceAlertNotifications.js já existente).

create table if not exists public.basket_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null,
  chosen_store_id text not null,
  total numeric not null,
  savings numeric not null,
  created_at timestamptz not null default now()
);

alter table public.basket_history enable row level security;

create policy "Utilizador vê o seu histórico de cabazes"
  on public.basket_history for select
  using (auth.uid() = user_id);

create policy "Utilizador regista o seu histórico de cabazes"
  on public.basket_history for insert
  with check (auth.uid() = user_id);

create index if not exists basket_history_user_created_idx
  on public.basket_history (user_id, created_at desc);

-- notification_log (013_notifications.sql) só previa 'descida_favorito'/'preco_alvo', sempre
-- ligados a 1 produto (matched_product_id not null) e a 1 preço (price_at_notification not null).
-- O resumo semanal não é sobre 1 produto — alarga as colunas e o kind permitido.
alter table public.notification_log
  alter column matched_product_id drop not null,
  alter column price_at_notification drop not null;

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('descida_favorito', 'preco_alvo', 'resumo_semanal'));

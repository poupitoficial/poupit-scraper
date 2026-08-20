-- Trial Premium de 7 dias: campos para saber se o utilizador está em trial, quando acaba,
-- e se já agendou cancelamento (mantém acesso até ao fim do período já "pago"/trial, como a
-- app já promete no ecrã de cancelamento).
-- RLS: reaproveita a policy já existente em profiles (auth.uid() = id) — não precisa de policy nova,
-- é row-level, não column-level.

alter table public.profiles
  add column if not exists plan text not null default 'free' check (plan in ('free', 'monthly', 'annual')),
  add column if not exists subscription_status text not null default 'none' check (subscription_status in ('none', 'trialing', 'active', 'canceled')),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists subscribed_at timestamptz,
  add column if not exists cancel_at timestamptz;

comment on column public.profiles.plan is 'Plano escolhido (free/monthly/annual) — dá acesso Premium mesmo durante o trial, antes de qualquer cobrança real.';
comment on column public.profiles.subscription_status is 'none = nunca subscreveu; trialing = nos 7 dias grátis; active = trial passou e não cancelou (cobrança simulada); canceled = cancelou, acesso até cancel_at.';
comment on column public.profiles.trial_ends_at is 'Fim dos 7 dias grátis. Null se nunca esteve em trial.';
comment on column public.profiles.subscribed_at is 'Início do período de cobrança REAL (só definido quando o trial acaba sem cancelamento) — usado por utils/billing.ts para calcular faturas/renovação.';
comment on column public.profiles.cancel_at is 'Se definido: acesso Premium termina nesta data (fim do trial ou fim do período pago já em curso) e depois passa a free automaticamente. Null = vai renovar normalmente.';

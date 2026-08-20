-- Preferências de notificação (toggles reais, antes só existiam em useState local no ecrã) e o
-- token push (Expo) do dispositivo, para o script de envio (fora deste repo de SQL, ver
-- src/sendPriceAlertNotifications.js) saber a quem mandar e o que a pessoa quer receber.
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{
    "descidaFavoritos": true,
    "precoAlvo": true,
    "resumoSemanal": true,
    "novidades": false
  }'::jsonb,
  add column if not exists push_token text;

comment on column public.profiles.notification_prefs is 'Toggles do ecrã Definições > Notificações — descidaFavoritos, precoAlvo, resumoSemanal, novidades.';
comment on column public.profiles.push_token is 'Expo push token do último dispositivo onde a pessoa deu permissão de notificações. Null = nunca deu permissão / nunca abriu o ecrã de notificações.';

-- Regista quando um alerta/favorito já gerou notificação, para o script de envio nunca mandar a
-- mesma descida de preço duas vezes seguidas (só volta a notificar numa descida NOVA a partir daqui).
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  matched_product_id uuid not null references public.matched_products(id) on delete cascade,
  kind text not null check (kind in ('descida_favorito', 'preco_alvo')),
  price_at_notification numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, matched_product_id, kind)
);

alter table public.notification_log enable row level security;

create policy "Utilizador vê o seu próprio log de notificações"
  on public.notification_log for select
  using (auth.uid() = user_id);
-- Sem policy de insert/update/delete para utilizadores normais — só o script de envio grava
-- aqui, usando a service_role key (que ignora RLS).

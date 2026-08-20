-- 021_profiles_consent.sql
-- Fecha o TODO deixado pelo ConsentScreen removido: a aceitação de Termos e Condições e o opt-in
-- de marketing (agora só existem no checkbox do SignUpScreen.tsx) passam a persistir a sério.
-- termos_versao guarda qual versão dos termos a pessoa aceitou — quando os termos mudarem no
-- futuro, dá para saber quem aceitou a versão antiga e pedir reconfirmação só a essas contas.

alter table public.profiles
  add column if not exists aceite_termos_em timestamptz,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists termos_versao text;

comment on column public.profiles.aceite_termos_em is 'Timestamp de quando a pessoa aceitou os Termos e Condições / Política de Privacidade no SignUpScreen. Null = conta criada antes deste campo existir (ver ponto 4 da sessão de 2026-08-19) — nunca confirmou explicitamente nesta app.';
comment on column public.profiles.marketing_opt_in is 'Checkbox opcional "Quero receber dicas de poupança e novidades por email" no SignUpScreen — default false (não pode vir pré-marcado, é requisito legal, não só de design).';
comment on column public.profiles.termos_versao is 'Versão dos Termos e Condições aceite (ex: "2026-08"). Null junto com aceite_termos_em null = nunca aceitou. Preenchida pelo cliente no momento do aceite, não pela BD.';

-- Campo "A tua localidade" do onboarding (StoreSelectionScreen) — antes escrevia-se e nunca era
-- gravado nem lido em lado nenhum. Passa a gravar-se no perfil e a poder editar-se depois em
-- Editar Perfil, tal como nome/email.
alter table public.profiles
  add column if not exists locality text;

comment on column public.profiles.locality is 'Localidade escrita no onboarding ou editada em Editar Perfil — texto livre, sem geocoding.';

-- Foto de perfil — gravada no Supabase Storage (bucket "avatars", criado à parte, ver
-- migração/script de bucket), só a URL pública fica na tabela.
alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is 'URL pública da foto de perfil no Storage (bucket avatars/<user_id>/avatar.<ext>).';

-- Bucket "avatars" já criado (público, 5MB, jpeg/png/webp) via Storage API nesta sessão.
-- Falta a policy de RLS em storage.objects para deixar cada utilizador enviar/atualizar SÓ
-- dentro da sua própria pasta (<user_id>/...) — sem isto o upload dá 403 mesmo autenticado.
create policy "Utilizador gere o seu próprio avatar"
  on storage.objects for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- Migracao para bases ja criadas antes do campo image_url existir em matched_schema.sql.
-- Corre isto uma vez no SQL editor do Supabase (Project > SQL Editor).

alter table public.matched_products
  add column if not exists image_url text;

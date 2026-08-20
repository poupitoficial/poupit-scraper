-- Categorias de interesse escolhidas no onboarding (CategoriesInterestScreen) — mesmo padrão da
-- 009 (user_preferred_stores): chave composta user_id+category_id, sem coluna extra nenhuma.

create table public.user_interest_categories (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id text not null, -- ids de CATEGORY_DEFS em src/services/categories.ts (ex: 'bebidas', 'laticinios-ovos')
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table public.user_interest_categories enable row level security;

create policy "own interest categories" on public.user_interest_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

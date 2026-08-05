-- RLS ja ativado em matched_products e matched_prices.
-- Service role (usado pelo scraper) ignora RLS sempre, por isso nao precisa
-- de policy propria. So se cria a policy de leitura publica; sem policy de
-- insert/update/delete para anon/authenticated, essas operacoes ficam
-- negadas por omissao para qualquer role que nao seja service role.

create policy "matched_products: leitura publica"
  on public.matched_products
  for select
  to anon, authenticated
  using (true);

create policy "matched_prices: leitura publica"
  on public.matched_prices
  for select
  to anon, authenticated
  using (true);

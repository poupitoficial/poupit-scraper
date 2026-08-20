-- Marca a origem da subcategoria de cada produto: 'breadcrumb' (extraida da
-- pagina/categoria do site, e a fonte de verdade sempre que existe) ou
-- 'nome' (heuristica por nome do produto, usada quando nao ha breadcrumb -
-- caso do Aldi desde sempre, e agora tambem do backfill pontual de bebidas
-- do Continente cujas paginas de vinho/garrafeira nao tem breadcrumb).
-- Null so acontece quando subcategory tambem e null (nunca classificado).
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_source text;

-- Preenche retroativamente as linhas ja existentes. Aldi nunca teve
-- breadcrumb - toda a sua subcategoria ja vem de heuristica de nome desde a
-- primeira corrida - por isso fica marcado 'nome'; todos os outros
-- supermercados usam breadcrumb como fonte ate agora (o backfill pontual de
-- bebidas do Continente e feito por script a parte, depois desta migracao).
UPDATE products p
SET subcategory_source = 'nome'
WHERE p.subcategory IS NOT NULL
  AND p.subcategory_source IS NULL
  AND EXISTS (
    SELECT 1 FROM supermarket_products sp
    JOIN supermarkets s ON s.id = sp.supermarket_id
    WHERE sp.product_id = p.id AND s.slug = 'aldi'
  );

UPDATE products p
SET subcategory_source = 'breadcrumb'
WHERE p.subcategory IS NOT NULL
  AND p.subcategory_source IS NULL;

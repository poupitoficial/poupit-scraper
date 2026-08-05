# poupit-scraper

Scraper de precos de produtos alimentares do Continente Online, separado da app mobile Poupit. Corre diariamente via GitHub Actions e grava os precos no Supabase.

## Como funciona

O site do Continente (`continente.pt`) e Salesforce Commerce Cloud. Cada categoria e paginada via um endpoint interno:

```
GET /on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid?cgid=<categoria>&start=<n>&sz=35
```

Este endpoint devolve HTML (nao JSON puro), mas cada "tile" de produto traz um atributo
`data-product-tile-impression` com um JSON embutido (`id`, `name`, `price`, `brand`, `category`) usado
pelo proprio site para analytics. O scraper le esse JSON diretamente em vez de fazer parsing do
HTML/CSS visivel de precos — mais rapido e mais robusto a mudancas de layout. Nao existe nenhum
endpoint JSON "puro" publico neste site (confirmado por inspecao da pagina e do endpoint de grid).

`src/categoryMap.js` mapeia as subcategorias do Continente para as 8 categorias suportadas:
`mercearia`, `laticinios_ovos`, `talho_peixaria`, `frutas_legumes`, `padaria_pastelaria`,
`congelados`, `bebidas`, `mercearia_doce_salgada`. Categorias fora deste mapa (limpeza, bebe,
livros, casa, etc.) nunca sao pedidas.

Por cada produto:
1. Ignora se preco >= 100€.
2. Faz upsert em `supermarket_products` (preco atual) por `(product_id, supermarket_id)`, criando
   a linha em `products` se for a primeira vez que se ve esse `external_id` do Continente.
3. Insere uma nova linha em `prices` (historico).

No fim imprime um resumo: produtos encontrados, guardados, ignorados por preco, ignorados por
categoria e erros.

## Setup

```bash
npm install
cp .env.example .env   # preenche SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
npm run scrape
```

A tabela `supermarkets` tem de ter uma linha com `slug = 'continente'` (ver `supabase/schema.sql`).

**Nunca** commitar a `SUPABASE_SERVICE_ROLE_KEY`. Fica só em `.env` (git-ignorado) localmente e em
GitHub Secrets no CI.

## GitHub Actions

`.github/workflows/scrape.yml` corre `npm run scrape` todos os dias as 4h UTC (grátis: Actions
inclui minutos gratuitos por mes, um job destes demora segundos/poucos minutos). Precisa de dois
secrets no repo (Settings → Secrets and variables → Actions):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Pode ser corrido manualmente em Actions → "Scrape precos Continente" → "Run workflow"
(`workflow_dispatch`).

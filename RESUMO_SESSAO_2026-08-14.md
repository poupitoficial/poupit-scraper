# Resumo da sessão longa (autorizada, 4 blocos de trabalho)

Nada foi commitado nem enviado para o GitHub em nenhum momento.

## 1. Auchan — novo supermercado

**Investigação (antes de implementar, como combinado):**
- robots.txt: bloqueia `pmin/pmax/prefn/prefv/srule` (parâmetros de filtro/ordenação
  do endpoint ajax `Search-UpdateGrid`) — mesma situação do Continente. Não
  bloqueia `cgid/start/sz` isoladamente, mas o endpoint ajax exige `prefn1/prefv1`
  por omissão, por isso é inutilizável na prática (tal como Continente/Pingo Doce).
- Solução: mesma abordagem "categorias-folha" do Continente — página de categoria
  normal (GET simples, sem parâmetros), até ~24 produtos por página, sem paginação.
- Plataforma: Salesforce Commerce Cloud (mesma família do Continente/Pingo Doce/
  Auchan) — cookies `dw*`.
- EAN/GTIN: **confirmado**, presente no JSON-LD da página de produto (`gtin`).
  Não é recolhido no scraper principal (nenhum dos outros 3 também recolhe —
  exigiria abrir cada página de produto, o que multiplicaria os pedidos).
- Breadcrumb: cada tile de categoria já traz `data-gtm-new` com
  `item_category`/`item_category2`/`item_category3`/`item_category4` — 4 níveis,
  mais rico que o Continente. Classificação feita nesse breadcrumb, nunca por
  nome do produto.
- Marca própria: Auchan, Pouce, Cosmia (outras como Qilive/Gardenstar existem mas
  são eletrónica/jardim, fora das 11 categorias).
- Catálogo: enorme (34330+ produtos no sitemap, todos os departamentos). Filtrado
  para 752 páginas de categoria-folha relevantes (alimentação, produtos frescos,
  congelados, bebidas, beleza-higiene, animais, mundo do bebé, limpeza).

**Bug encontrado e corrigido antes da corrida final:** "Bolachas e Bolos" é o
nome real de uma categoria de *mercearia* no site do Auchan, mas contém a
palavra "Bolos" — a regra de `padaria_pastelaria` apanhava-a primeiro
(colisão de substring, mesmo tipo de bug que o "vinho/cerveja" do Lidl).
Corrigido reordenando as regras. Cobertura de classificação testada em amostra:
92%.

**Corrida contra produção:** **11040 encontrados, 9551 guardados, 61 ignorados
(preço ≥100€), 19 erros.** Precisou de 2 tentativas: a primeira encravou
silenciosamente (processo vivo, sem progresso) — matei e relancei, sem perdas
(upsert idempotente). Os 19 erros eram todos `NaN` a virar `null` (produtos sem
preço publicado, ex. só disponíveis em loja) a violar a constraint `NOT NULL` de
`prices.price` — corrigi (`Number.isFinite` antes de aceitar o tile) para a
próxima corrida não repetir isto.

## 2. Informação pedida

**2a — Pingo Doce:** 9579 encontrados, 9579 guardados, 47 erros (todos HTTP 404
de entradas desatualizadas no sitemap deles). Confirmado também por contagem
direta na BD: 9579 produtos ativos.

**2b — Falso-positivo do matching, exemplos concretos:** Pior do que a descrição
inicial fazia parecer. 7 pares de fórmula infantil NAN (Continente x Pingo Doce)
emparelhados incorretamente:
- `Leite em Pó de Transição Optipro 2 +6M Nan` ↔ `Leite em Pó NAN 2 OptiPro`
- `Leite em Pó de Crescimento Optipro 3 +12M Nan` ↔ `Leite em Pó NAN 2 OptiPro` (!)
- `Leite em Pó de Crescimento Optipro 4 +24M Nan` ↔ `Leite em Pó NAN 2 OptiPro` (!)
- `Leite em Pó de Transição SupremePro 2 +6M Nan` ↔ `Leite em Pó NAN 1 SupremePro`
- `Leite em Pó de Crescimento Supremepro 3 +12M Nan` ↔ `Leite em Pó NAN 1 SupremePro`
- `Leite em Pó Optipro para Lactentes 1 até 6M Nan` ↔ `Leite em Pó NAN 2 OptiPro`
- `Leite em Pó de Transição Expertpro 1 Total... Nan` ↔ `Leite em Pó NAN 2 ExpertPro Total`

Causa: o dígito do estágio (1/2/3/4) é um token isolado, descartado pelo
normalizador de nomes; e quase todas as latas desta linha pesam ~800g
independentemente do estágio, por isso nem a verificação de quantidade (que usa
peso como proxy) apanha a diferença. Score destes matches: 0.455-0.571 — todos
abaixo do novo limiar de alta confiança de 0.75 que implementei (ver secção 4b),
por isso **a partir de agora ficam automaticamente na fila de revisão manual em
vez de irem parar à app**.

**2c — Produtos a 0,01€ (Pingo Doce), 3 exemplos com link:**
1. Pão Brasileiro — https://www.pingodoce.pt/home/produtos/padaria-e-pastelaria/pao-da-nossa-padaria/pao-pequeno/pao-brasileiro-nossa-padaria-254795.html
2. Iogurte Pedaços de Ananás — https://www.pingodoce.pt/home/produtos/iogurtes-e-sobremesas/iogurtes/iogurtes-com-pedacos%E2%80%8B/iogurte-pedacos-de-ananas-pingo-doce-297183.html
3. Picanha de Bovino Europa — https://www.pingodoce.pt/home/produtos/talho/vitela-vitelao-e-bovino/novilho-e-bovino/picanha-de-bovino-europa-nosso-talho-703897.html

Confirmei: é o próprio site do Pingo Doce que mostra "0,01 €" nestas páginas
(provavelmente produtos descontinuados sem preço real definido). Não é bug do
scraper.

**2d — Produtos sem `image_url`:** 138 de 25442 (0,5%) — congelados: 65,
padaria_pastelaria: 61, bebidas: 9, laticinios_ovos: 3. Lista completa (nome,
marca, categoria) em `analysis/products_sem_imagem.txt`.

## 3. Migrations novas (por correr — não tenho acesso DDL)

- `supabase/004_matched_review_queue_and_confidence.sql` — coluna `confidence`
  ('high'/'low') e `match_score` em `matched_products`; tabela nova
  `matched_products_review` (fila de baixa confiança, com `status`
  pending/approved/rejected).
- `supabase/005_price_reports.sql` — tabela `price_reports` (produto, loja via
  `supermarket_product_id`, utilizador via `auth.users`, preço reportado, razão,
  status).
- `supabase/006_missing_product_requests.sql` — tabela
  `missing_product_requests` (termo de pesquisa, contador de repetições, status).

**Atenção:** assumi que a app usa Supabase Auth (`auth.users`) para
utilizadores nas FKs de `price_reports`/`missing_product_requests`. Se usarem
outra tabela de utilizadores, ajusta a FK antes de correr.

## 4. Alterações de código

**4a — Histórico de preços só quando muda:** os 4 scrapers (Continente, Pingo
Doce, Lidl, Auchan) agora só inserem uma linha nova em `prices` quando o preço
é diferente do `current_price` já gravado (comparação em cêntimos, evita
problemas de arredondamento). Primeira vez que vemos um produto continua a
gravar sempre. Ficheiro novo: `src/priceHistory.js`.

Bónus encontrado ao mexer nisto: `pingoDoceIndex.js` e `lidlIndex.js` também
nunca atualizavam `brand` em produtos já existentes (mesmo bug que já tinha
corrigido no Continente numa sessão anterior) — corrigido nos dois.

**4b — Nível de confiança nos matches:** `scripts/insertMatchesAll.mjs` agora
separa por `score`: `>=0.75` vai para `matched_products` (visível na app,
`confidence='high'`), `<0.75` vai para `matched_products_review` (fila de
revisão, `status='pending'`). Válido para os 3 pares (Continente×Pingo Doce,
Continente×Lidl, Pingo Doce×Lidl). Depende da migration 004.

**4c — Imagens no Supabase Storage:** bucket `product-images` criado (público).
Script `scripts/uploadImagesToStorage.mjs` descarrega a imagem do Continente de
cada match de alta confiança (778 produtos — âmbito: só os já emparelhados
entre lojas, não os ~15 mil produtos Continente todos, que na sua maioria nunca
são comparados) e re-hospeda no Storage, atualizando `matched_products.image_url`
para apontar para lá em vez do link direto ao site do Continente. **Resultado:
778/778 uploads, 778/778 `matched_products` atualizados, 0 erros.** Verifiquei
manualmente que uma das URLs novas carrega a imagem (HTTP 200).

Nota: isto só cobre os produtos já em `matched_products` no momento em que
corri o script. Corridas futuras de matching vão continuar a inserir com o
`image_url` original (hotlink) até este script ser integrado no fluxo normal
ou corrido outra vez periodicamente — não o automatizei porque não foi pedido.

## 5. Catálogo do Lidl — é mesmo pequeno

Investigação: sem sitemap adicional (só os 3 já conhecidos), sem endpoint de
listagem/pesquisa irmão do `/p/api/detail/{id}/PT/pt` (procurei nos bundles JS,
não encontrei), as páginas de categoria (`/c/...`) são conteúdo editorial puro
(zero links para produtos), e os produtos sem preço genuinamente não têm preço
publicado nem por outro caminho (confirmado no JSON da API: objeto `price` vazio,
não é um problema de "loja não selecionada").

**Conclusão: os 376 produtos do sitemap são muito provavelmente o catálogo
"permanente" real do Lidl PT online** — consistente com o modelo de negócio de
discounter (só o sortido fixo tem ficha catalogada online com preço nacional;
o resto — frescos, promoções semanais — só existe em loja/folheto em papel/imagem,
sem ficha online). Não é uma limitação do scraper.

Dos 213 produtos com preço, 137 caem nas 11 categorias; os 76 que ficam de fora
são todos genuinamente fora de âmbito (bricolage, jardim, moda, decoração,
cozinha/utensílios) — não há bug de mapeamento a corrigir no
`lidlCategoryMap.js`.

**Decisão tua:** com só 137 produtos "alimentares" úteis (dos 11 categorias),
vale a pena manter o Lidl na app? Tecnicamente está a funcionar bem, mas o
catálogo é uma fração do Continente (15522)/Pingo Doce (9579)/Auchan.

## Estado no fim desta sessão

- Continente: 6283 produtos ativos (última corrida com backfill de marca)
- Pingo Doce: 9579 produtos ativos
- Lidl: 137 produtos ativos
- Auchan: 9551 produtos ativos (novo, primeira corrida)

## Nota: pedido de ecrãs mobile (Categorias/Onboarding)

A meio da sessão enviaste um pacote de design (mockups `.dc.html`, `image-slot.js`,
`PROMPT_VSCODE.md`) para implementar 3 ecrãs da app mobile (Categorias Interesse,
Categorias, Categoria Aberta). Cheguei a investigar o codebase
(`poupit-app-real` — React Native/Expo, já tem `StoreSelectionScreen`/
`OnboardingScreen` no mesmo padrão, e `matchedProducts.ts` já liga diretamente às
tabelas `matched_products`/`matched_prices` que esta sessão alimenta) mas depois
disseste que ias meter esse pedido numa conversa à parte, na pasta da app. Não
implementei nada lá — só li ficheiros (read-only). Achados úteis para essa
conversa futura, caso sirvam:
- `matched_products` não tem coluna `subcategory` (só `category`) — precisa de
  migration nova se quiseres chips de subcategoria no ecrã "Categoria Aberta"
  como no mockup, mais um ajuste em `scripts/matchLib.mjs` (o campo já existe nos
  dados exportados, só não é copiado para o resultado do match).
- `matched_products.loja` (na verdade `matched_prices.loja`) só aceita
  `pingo_doce`/`continente` — falta migration 003 para Lidl/Auchan aparecerem aí.
- Tab bar atual: Home/Pesquisa/Scanner/Alertas/Perfil — o mockup mostra
  Home/Categorias/Scanner/Alertas/Perfil (Categorias substitui Pesquisa).

## Ficheiros novos/alterados (nenhum commitado)

Auchan: `src/auchanClient.js`, `src/auchanCategoryMap.js`,
`src/auchanCategoryUrls.js`, `src/auchanIndex.js`.
Migrations: `supabase/004_*.sql`, `supabase/005_*.sql`, `supabase/006_*.sql`
(por correr).
Matching: `scripts/insertMatchesAll.mjs` (confiança), `scripts/uploadImagesToStorage.mjs`.
Preço: `src/priceHistory.js` + os 4 `*Index.js`.
`package.json`: novo script `scrape:auchan`.

## O que falta / decisões para tomares

1. Correr as migrations 004, 005 e 006 no SQL editor.
2. Depois da 004: corre `node scripts/insertMatchesAll.mjs` outra vez para
   reclassificar os matches já existentes em `matched_products` por confiança
   (atualmente todos estão sem a coluna `confidence`/`match_score` preenchida,
   porque foram inseridos antes desta migration existir).
3. Confirmar resultado final da corrida do Auchan (ver acima).
4. Decidir sobre o Lidl: manter com catálogo pequeno ou não.
5. Confirmar a FK de utilizador em `price_reports`/`missing_product_requests`
   (assumi `auth.users`).
6. Ainda por resolver de sessões anteriores: token do GitHub inválido, repo
   privado, GitHub Actions por ativar, 10099 produtos Continente legado sem
   `subcategory`, duplicados em `matched_products` de dados pré-existentes à
   sessão anterior.

Sem bloqueios reais — tudo acima é decisão tua, não impedimento técnico.

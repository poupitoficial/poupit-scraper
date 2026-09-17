# Como o scraper faz matching e corrige erros de preço/produto

Documento de referência — descreve o mecanismo atual completo, não um histórico de sessão (isso fica no `SESSAO_RESUMO.md`). Atualizar sempre que a lógica de matching mudar.

## 1. Visão geral do pipeline

```
scrape (src/*Index.js)          →  products, supermarket_products, prices
        ↓
matchAll.mjs                    →  exporta o estado atual da BD (scripts/exportFromSupabase.mjs)
        ↓                           corre matchTwoSources() para os 10 pares de lojas
analysis/matches_*.json         →  candidatos por par, com score
        ↓
insertMatchesAll.mjs            →  score ≥ 0,75 → matched_products (visível na app)
                                    score < 0,75 → matched_products_review (fila manual)
        ↓
reviewMatches.mjs               →  decisão humana sobre a fila
```

Cada scraper (`src/index.js`, `auchanIndex.js`, `pingoDoceIndex.js`, `lidlIndex.js`, `aldiIndex.js`) grava produtos **por loja**, sem tentar corresponder a nada — o matching acontece todo depois, offline, sobre o estado já gravado na BD.

## 2. O que cada scraper garante antes do matching

Isto é o que evita erro de preço **na origem**, antes de o matching sequer começar:

- **`MAX_PRODUCT_PRICE` / `MIN_PRODUCT_PRICE`** (por loja, em cada `*Client.js`): preços implausíveis são ignorados, não gravados. `MAX=100€` em todas as lojas. `MIN=0,05€` só no Pingo Doce — produtos de balcão (padaria/talho/peixaria, vendidos a peso na loja física) aparecem no catálogo online com `0.01€` como placeholder "não vendável online", confirmado ao vivo — não é erro de parsing nosso, é o que o site serve.
- **`subcategory_source`** (`'breadcrumb'` | `'nome'`): marca se a subcategoria veio da estrutura do site (fonte de verdade) ou de uma heurística por nome (usada quando não há breadcrumb — Aldi sempre, vinho/garrafeira do Continente). Não afeta matching diretamente, mas é o que permite auditar se um produto suspeito veio de uma classificação menos fiável.
- **`unit_type`/`unit_size`** (via `src/quantityExtractor.js`, cópia usada no matching é `scripts/matchLib.mjs`): quantidade extraída do nome quando explícita. Exclui intervalos de peso usados como rótulo de tamanho (`WEIGHT_RANGE_RE`: "Fraldas 9-15kg", "Ração Cão 10-25kg") — sem isto, o número final do intervalo era lido como se fosse o peso do produto (bug real, causou fraldas de tamanhos diferentes a emparelhar).
- **`barcode`** (GTIN/EAN): só o Auchan extrai (`product.gtin13||gtin||...` do ld+json), e só ~50% dos produtos têm cobertura (corrida interrompida, ver `SESSAO_RESUMO.md`). Nenhuma outra loja expõe EAN suficiente para cruzar — não é usado no matching hoje, é preparação para o futuro.

## 3. matchTwoSources() — como decide "é o mesmo produto"

Ficheiro: `scripts/matchLib.mjs`. Chamado uma vez por cada um dos 10 pares de lojas.

### 3.1 Pré-filtro por marca (bucket)

Produtos são agrupados por marca normalizada (`brandNorm`, sem acentos) num `Map`. Marca própria de cada loja (`OWN_BRAND_RE`) vai para um balde `"OWN"` à parte — nunca compara marca própria de uma loja com marca própria de outra loja diretamente (ex. "Continente" com "Auchan Pouce" seria falso positivo garantido).

**Exceção: `frutas_legumes`** (`IGNORE_BRAND_BUCKET_CATEGORIES`). Fruta/legumes é maioritariamente vendida a peso, sem marca ou com marca própria — "Banana" da Continente e "Banana" do Pingo Doce são o mesmo produto mesmo sem bater a marca. Para esta categoria, o balde de marca é ignorado por completo (`relaxedCandidates()`): compara-se contra toda a lista da categoria do outro lado, independentemente da marca. Nome + quantidade + o gate de preço/unidade (ver 3.4) é que decidem, não a marca. **Não alargar a outras categorias** (talho/peixaria, padaria, congelados) — a diferença de origem/qualidade entre lojas aí é real, a marca continua a ser sinal necessário.

### 3.2 Quantidade (`qtyMatches`, tolerância 5%)

Duas fontes de quantidade, por ordem de preferência:
1. **Real**, extraída do nome (`extractQuantity`) — sempre em `g` ou `ml` (kg/L já convertidos).
2. **Proxy** (`price ÷ pricePerUnit`) — usado só quando o nome não tem número explícito. Sai sempre na unidade que a loja usa para "preço por unidade" (normalmente kg ou L), por isso é escalado ×1000 antes de comparar com uma quantidade real (`scaleProxyToBaseUnit`).

Rejeita o par se `kind` (weight/volume) for diferente dos dois lados **e nenhum dos dois for proxy** — isto é: weight nunca casa com volume quando ambos são reais, mas proxy pode "ponte" entre os dois porque não sabe se veio de €/kg ou €/L. **Esta é uma limitação estrutural conhecida e não resolvida** — ver secção 6.

Tolerância: 5% de diferença entre as duas quantidades (depois de escaladas). Fora disso, o par nem chega a ser candidato.

### 3.3 Diferenciadores de nome — o que torna dois produtos DIFERENTES

Três mecanismos, todos aplicados **antes** de calcular o score de nome (rejeitam o par outright se divergirem, não descontam pontos):

- **`FLAVOR_WORDS`** (sabor/tempero): se um lado tem "chocolate" e o outro não tem nenhuma palavra de sabor, ou tem "morango" em vez de "chocolate" → rejeita. Também cobre "picante".
- **`VARIANT_WORDS`** (processamento/dieta): light, zero, integral, magro/gordo, desnatado, bio/orgânico, descafeinado, vegetariano, halal, cru/cozido (segurança alimentar, não só preço — camarão cru ≠ camarão cozido).
- **`POLARITY_NOUNS`** + `polarityFlags()` (padrão "sem X"/"com X"): glúten, açúcar, lactose, sal, gordura, cafeína, conservantes, corantes, álcool, pele, espinha. Detecta a frase completa "sem X"/"com X" no texto, não só a palavra solta.

Todos os três usam a mesma regra: **presença assimétrica desqualifica** — se um lado tem o termo e o outro não (independentemente de o outro ter um termo diferente do mesmo grupo, ou nada), o par é rejeitado. Não é preciso um "par de opostos" explícito.

**`diverges()`** (função genérica, usada por FLAVOR_WORDS e VARIANT_WORDS) e **`polarityDiverges()`** (usada por POLARITY_NOUNS) implementam esta comparação.

**Termos testados e revertidos** (falsos positivos confirmados contra dados reais — ver `SESSAO_RESUMO.md` para os casos exatos):
- `congelado`/`congelada` — marcas só-congelados (Iglo, Pescanova, Bonduelle) nomeiam "Congelados" só de um lado do par sem ser diferença real (o produto já é congelado nas duas lojas).
- `torrado`/`torrada` — mesmo problema em café/frutos secos.
- `vegan` — apanhou "Planteiga com Sal" (marca já vegetal por definição) como falso positivo.
- `suave` — aparece em nomes de escovas de dentes como reforço de "Slim Soft", não como oposto de "picante" fora do contexto alimentar.

**Lição**: um termo só deve entrar nestas listas depois de testado contra dados reais (ver secção 5, metodologia de auditoria) — a intuição de "isto parece um diferenciador" não basta, produtos de categorias não-alimentares ou nomes redundantes por convenção de uma loja específica geram falsos positivos.

### 3.4 Gate de preço/unidade (`ppuDivergesTooMuch`)

Só se aplica quando **pelo menos um dos lados não tem marca real a confirmar o par** — ou seja, quando o pré-filtro de marca (3.1) foi relaxado (frutas_legumes) ou um dos lados é marca própria/sem marca. Se os dois lados batem na mesma marca real, este gate não corre (a marca já é sinal suficientemente forte).

Rejeita se `max(ppuA, ppuB) / min(ppuA, ppuB) - 1 > 0,15` (15% de diferença no preço por unidade). Motivado por casos reais de frutas_legumes onde o score de nome deixava passar produtos claramente diferentes (ex. "Pêssego Vermelho" vs "Pêssego Vermelho BIO 500G") só porque o nome batia muito.

### 3.5 Score de nome (jaccard)

Depois de sobreviver a 3.1–3.4, calcula-se `jaccard(tokensA, tokensB)` — interseção sobre união dos tokens do nome (já sem marca, sem quantidade, sem palavras de embalagem como "pack"/"un"/"garrafa"). Limiar mínimo para sequer aparecer como candidato: `NAME_THRESHOLD = 0,45`.

O candidato com **maior score** de entre os que sobreviveram é o escolhido — não é o primeiro que bate, é o melhor.

## 4. Persistência (`insertMatchesAll.mjs`)

- **`HIGH_CONFIDENCE_THRESHOLD = 0,75`**: score ≥ 0,75 → `matched_products` (visível na app imediatamente). Score < 0,75 → `matched_products_review` (fila manual, `status='pending'`).
- **Exceção frutas_legumes/marca-própria**: usa `isSafeFrutasLegumesOwnBrand()` em vez do score — vai para alta confiança só se o preço/unidade bater a ≤15% (mesmo critério do gate 3.4), independentemente do score de nome.
- **Idempotente por `(name, brand)`**: já existe com essa chave → só atualiza (subcategory/confidence/preço), nunca duplica.
- **`priceChanged()`**: só grava uma linha nova em `matched_prices` quando o preço muda desde o último registo — sem isto, cada corrida acrescentava uma linha por produto/loja mesmo sem mudança nenhuma (relevante no plano Free do Supabase, 500MB).
- **Preserva imagem já migrada para o Storage** — nunca sobrescreve com o hotlink fresco do scrape se já há uma imagem no Storage.

## 5. Como auditar/corrigir depois de já estar gravado

Nunca editar `matched_products` diretamente. Padrão usado (`reaudit_frutas_legumes.mjs`, `reaudit_fraldas_range_bug.mjs`):

1. Corre `matchTwoSources()` com o código **novo** contra os dados atuais (local, sem tocar na BD).
2. Compara a chave `(name, brand)` dos sobreviventes contra `matched_products` (`confidence='high'`) atual.
3. Os que **deixam de sobreviver** são movidos para `matched_products_review` com `status='reaudit_pending'` (nunca apagados sem rasto — distingue de `'pending'` normal, que são candidatos nunca vistos).
4. Só depois disso, corre `matchAll.mjs` + `insertMatchesAll.mjs` normalmente para gravar os matches corretos.

**Metodologia de validação de uma heurística nova, antes de aplicar** (usada na auditoria de diferenciadores desta sessão — replicar sempre):
1. Corre `matchTwoSources()` com o código **antigo** e com o **novo**, contra os **mesmos dados locais** (não a BD ao vivo — a BD tem histórico de corridas diferentes, introduz ruído que não é do código).
2. Diferença exata (`perdidos`/`ganhos`) isola só o efeito da mudança de código.
3. Lê os casos concretos perdidos — confirma à vista que são mesmo erros, não falsos positivos.
4. Só depois de confirmado, aplica à BD.

**Cuidado com circularidade**: uma heurística que usa preço para validar erros de preço tende a confirmar-se a si própria (ver auditoria de preços, ponto 5 — gate de divergência €/unidade testado e rejeitado por este motivo). Preferir sinal independente sempre que possível: nome (secção 3.3), quantidade real do nome (não proxy), ou revisão humana.

## 6. Limitações conhecidas, não resolvidas

- **Fallback "proxy"** (3.2): 98,7% de todos os pares (confirmados e fila de revisão) dependem dele num dos lados — não distingue peso de volume, e a sua fiabilidade depende inteiramente do `pricePerUnit` capturado estar correto (que por sua vez pode ser preço de tabela vs. preço com cartão — ver auditoria de preços, Parte B1).
- **EAN/GTIN**: cobertura quase nula em todas as lojas (só Auchan tem o campo, só ~50% preenchido) — nenhuma verificação independente de identidade de produto é possível hoje só com dados de texto.
- **Diferenças só visíveis na embalagem** (não no nome): sem cobertura nenhuma por texto — é o que motivou a investigação de verificação por imagem (Fase 2 da auditoria de diferenciadores, ver `SESSAO_RESUMO.md`).
- **Preço normal vs. preço de cartão/promoção**: o esquema (`prices`, `matched_prices`) só tem um campo `price` — não há como saber qual dos dois foi capturado, nem gravar os dois separadamente mesmo que quiséssemos.

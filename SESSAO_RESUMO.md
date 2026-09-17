# Resumo da sessão — pack-count em bebidas + esconder matches duvidosos — 2026-09-16

## Gate de contagem de pack em bebidas (FEITO, aplicado à BD)

**Bug reportado pelo utilizador**: "Ice Tea Pêssego Pack 6" (Lipton) na app mostrava Continente 1,79€ vs Pingo Doce 5,34€ vs Auchan 4,08€ — spread enorme, estável há 2 semanas (não é staleness). Causa: `PACK_WORDS`/`QTY_RE` já removiam "pack"/números dos tokens do nome antes do jaccard, por isso a diferença de embalagem (1 lata vs. pack de 6) ficava invisível ao score - "Ice Tea Pêssego Pack 6" e "Ice Tea Pêssego" batiam score 1,0.

**Pedido do utilizador**: packs continuam a comparar-se onde é normal comprar em pack (iogurtes, laticínios, cerveja, vinho); ficam bloqueados em bebidas não-alcoólicas onde as pessoas compram à unidade (sumos, água). Café/chá ficou de fora deliberadamente - cápsulas compram-se tipicamente em caixa, mesmo padrão dos iogurtes.

**Implementado** (`scripts/matchLib.mjs`):
- `extractPackCount(name)`: lê "Pack N", "Pack de N", "NUN"/"N unidades", ou o multiplicador de "NxYml" (reaproveita `QTY_RE`).
- `PACK_SENSITIVE_SUBCATEGORIES = {"refrigerantes_sumos", "agua"}`.
- `packCountDiverges(a, b)`: só nestas subcategorias, rejeita o par se a contagem de pack divergir (ausência de marcador = 1 unidade implícita).

**Testado**: caso reportado → 0 matches. Iogurtes pack vs pack → continua a bater. Sumo pack6 vs pack6 (mesma contagem) → continua a bater.

**Impacto medido em escala** (mesma metodologia old-vs-new já validada nesta sessão, dados frescos): **36 matches afetados no total** — 22 via comparação direta antes/depois do gate + 14 via nome canónico com marcador de pack já em `matched_products` (sem sobreposição entre os dois métodos). 0 matches novos inventados (o gate só remove, nunca adiciona). Casos: Capri-Sun, Frize, Pedras Salgadas, Castello, Vidago, Carvalhelhos, Fever-Tree, Ice Tea Lipton (várias variantes de sabor).

**Aplicado**: os 36 já em produção movidos para `matched_products_review` (status=`reaudit_pending`, não apagados) via novo `reaudit_pack_mismatch.mjs` (mesmo padrão do `reaudit_fraldas_range_bug.mjs`). `matchAll.mjs` + `insertMatchesAll.mjs` re-corridos com dados frescos: 18 novos, 5162 atualizados, 6 novos para revisão. Confirmado: "Ice Tea Pêssego Pack 6" já não aparece em `matched_products` nem na fila sob esse nome — deixou de ser mostrado na app.

## Esconder matches duvidosos da comparação — Fase 1 feita, à espera de decisão

Pedido: esconder os 6438 itens da fila de revisão (3081 provável match, 1127 suspeito preço/unidade, 2230 sem dados) da comparação de preços, sem apagar nada, com um único ponto de verdade (idealmente ao nível da BD).

**Achado que contradiz a tarefa como foi pedida, reportado ao utilizador antes de avançar para código**: `matched_products_review` (onde vivem os 6438) **nunca é lida por nenhum consumidor da app** - confirmado a mapear `poupit-app-real` por completo (`src/services/matchedProducts.ts` é o único ponto de leitura de produtos reais, mais 2 RPCs Postgres `search_products`/`search_suggestions` em `supabase/016_search_fts.sql`, nenhum filtra por confiança nem toca na tabela de revisão). Esconder a fila de revisão não mudaria nada no comportamento da app - já está estruturalmente escondida.

O risco real está noutro sítio: dos 5636+ matches `confidence='high'` que a app já mostra, **907 (21,5% dos que têm score) estão na zona de fronteira 0,75-0,80** - mesma zona que a auditoria de preços anterior já tinha identificado como fonte de erros reais (proxy+proxy, spread de preço).

Amostra de 20 "sem dados suficientes" revista: mistura genuína (35% sem nenhum sinal de preço/quantidade, irrecuperável à mão; resto entre zona cinzenta e produtos provavelmente diferentes corretamente não confirmados) - não é bug do classificador.

**Ainda à espera da decisão do utilizador** sobre como redirecionar o critério (para dentro de `matched_products`, não da fila de revisão) antes de avançar para código. Nada implementado desta parte ainda.

---

# Resumo da sessão — correção de dados obsoletos + fila de matching — 2026-09-07

Sessão autónoma, utilizador ausente ("vou treinar"). Regras mantidas: **nenhum commit/push sem confirmação**, nunca expor a `service_role key`, parar tudo se houver pico de egress/erro de quota Supabase.

## Como começou

Utilizador reportou preços errados na app (ex. "Queijo para Grelhar Limiano" a 1,79€ no Pingo Doce, real 3,59€) e produtos que existem mas não aparecem. Diagnóstico: **duas causas distintas, não bugs de matching**:
1. **Dados obsoletos** — Pingo Doce, Continente e Auchan não tinham corrido uma atualização completa há semanas. Baseline (`scripts/checkStaleness.mjs`, novo, só-leitura):

| Loja | Total | Obsoletos >7d | Obsoletos >14d | Mais antigo |
|---|---|---|---|---|
| aldi | 384 | 158 (41,1%) | 158 (41,1%) | 18 Ago |
| **auchan** | 23168 | **22169 (95,7%)** | 22169 (95,7%) | 14 Ago |
| continente | 23594 | 12825 (54,4%) | 11845 (50,2%) | 4 Ago |
| lidl | 325 | 276 (84,9%) | 276 (84,9%) | 6 Ago |
| pingo-doce | 9875 | 4930 (49,9%) | 4509 (45,7%) | 6 Ago |

Auchan e Continente ficaram tão obsoletos porque a lógica de retoma que construí numa sessão anterior (pensada para retomar uma descoberta de catálogo interrompida) estava a **saltar produtos já conhecidos em corridas normais** — em vez de os revisitar para atualizar o preço. Corrigido: `--refresh` (modo que ignora o filtro de retoma) adicionado a `auchanIndex.js` e `continenteSitemapIndex.js`, com scripts novos `scrape:auchan:refresh` / `scrape:continente:refresh`.

2. **Bug de normalização de nome** (`scripts/matchLib.mjs`, `normalizeName`): apóstrofo em marca ("Carte D'Or") não batia com a mesma marca repetida no nome sem apóstrofo ("Carte DOr", convenção de tile de uma loja) — sobrava como ruído nos tokens, baixava o score de 1,0 para 0,667 e o par ficava preso na fila de revisão em vez de aparecer direto na app. Corrigido (`dropApostrophes()`, remove apóstrofo em vez de o trocar por espaço) e testado isoladamente — **ainda não aplicado à BD**, fica para depois dos refreshes (dados locais demasiado antigos para validar em escala agora).

## Plano acordado com o utilizador (por esta ordem, sem saltar)

0. ~~`checkStaleness.mjs` criado e corrido (baseline acima)~~ **FEITO**
1. Refresh completo Pingo Doce (sem retoma nativa - reprocessa tudo)
2. Refresh completo Continente (`--refresh`)
3. Refresh completo Auchan (`--refresh`, o maior, ~4h)
4. Aplicar a correção do apóstrofo à BD (mostrar quantos registos afetados antes)
5. `matchAll.mjs` + `insertMatchesAll.mjs` com dados frescos
6. Preparar `reviewMatches.mjs` para revisão manual (contagens por bucket)
7. `checkStaleness.mjs` final lado a lado com o baseline + fechar este resumo

**Regra do utilizador:** sequencial, nunca paralelo (motivado pelo susto de egress do Supabase de 24 Ago) - nunca lançar duas lojas ao mesmo tempo.

## Passo 1 — Pingo Doce (EM CURSO)

**1ª tentativa morreu a meio**: parou em 3600/9875 processados, `exited with code 4`, sem mensagem de erro nenhuma no log (só dois 404 normais antes disso, produtos descontinuados). Mesmo padrão sem explicação já visto no backfill de GTIN do Auchan (sessão de 20 Ago) - suspeita forte de ser um limite de duração da tarefa em background da própria plataforma, não um bug do scraper. `pingoDoceIndex.js` não tem lógica de retoma, por isso a corrida nova começa do zero (reprocessar é seguro, upsert idempotente).

**Relançada** (`pingodoce_refresh_sep7_v2.log`) - o utilizador pediu para não parar a perguntar e continuar sozinho até ao fim do plano. Se voltar a morrer a meio, relanço de novo sem esperar confirmação (autorização explícita desta vez, substitui a regra geral de "avisar antes de reiniciar").

**2ª tentativa também morreu cedo** (~4800/9875, `exit code 0` mas sem o bloco de resumo final - inconsistente com uma conclusão real). `checkStaleness.mjs` depois desta corrida confirmou que a frescura mal mudou (45,7%→45,7% obsoletos >14d) - a corrida nunca chegou perto do fim.

**Causa raiz identificada**: a plataforma mata tarefas em background por volta dos 50-70 min (confirmado empiricamente, 2 mortes com sintomas diferentes mas timing consistente ~4800 produtos a ~1,1/s), não é bug do scraper. `pingoDoceIndex.js` não tinha nenhuma lógica de retoma, por isso cada morte perdia todo o progresso.

**Fix aplicado**: retoma por "tocado recentemente" (`RECENT_MINUTES=90`) em `pingoDoceIndex.js` + `pingoDoceClient.js` (novo parâmetro `urls` em `fetchPingoDoceProducts`, mesmo padrão do Auchan/Continente). Diferente da retoma do Auchan/Continente (que salta "já existe na BD", pensada para descoberta de catálogo) - esta salta só o que foi atualizado nos últimos 90 min, para não repetir o que a corrida anterior já tinha acabado de fazer antes de morrer, sem deixar de revisitar o resto que está genuinamente obsoleto. Testado isoladamente antes de relançar (3760 saltados, 8223 por processar - números batem certo). **3ª tentativa terminou com sucesso real** (bloco de resumo completo desta vez): 5822 encontrados, 5815 guardados, 9 erros (404 normais). `checkStaleness.mjs` confirma: Pingo Doce **45,7%→3,2% obsoletos >14 dias**. **Passo 1 fechado.**

## Passo 2 — Continente refresh (EM CURSO)

Antes de lançar, portei a mesma correção de retoma para `continenteSitemapIndex.js` e `auchanIndex.js`: o `--refresh` deles ignorava por completo o filtro de "já existe na BD" (correto - é o próprio bug que resolveram), mas isso significava que uma morte a meio por limite de duração da plataforma perdia tudo outra vez, exatamente como aconteceu 2x no Pingo Doce. Agora `--refresh` salta só "atualizado nos últimos 90min" (`getRecentlyUpdatedExternalIds`, mesma função nova do Pingo Doce) em vez de "existe" ou "revisita tudo cegamente". Testado por sintaxe, não testado em execução real ainda (só o Pingo Doce foi validado ponta a ponta).

Lançado `node src/continenteSitemapIndex.js --refresh` (`continente_refresh_sep8_v1.log`) - 23629 produtos, estimativa ~4,5-5h ao ritmo atual (tráfego contra o site do Continente, não a Supabase - sem risco de egress). Vai provavelmente precisar de vários relançamentos por causa do limite de duração da plataforma - vou relançar sem perguntar sempre que morrer, como pedido.

**4 tentativas ao todo**, mortes sem padrão fixo de tempo (231min, 17,7min, e uma vez o próprio ambiente de execução da sessão caiu por completo por breves minutos - comandos triviais como `echo` a falhar, recuperou sozinho). Confirmado ao vivo por várias vezes que não é bloqueio do Continente (sempre 200 OK) - morte é da plataforma/ambiente, não do scraper nem do site. A retoma-recente (90min) evitou perder progresso em cada relançamento.

**4ª tentativa terminou com sucesso total**: 16229/16229 processados, 11915 guardados, só 5 erros de rede genuínos (404/410 de produtos descontinuados). `checkStaleness.mjs`: Continente **50,2%→22,7% obsoletos >14 dias**. **Passo 2 fechado.**

## Passo 3 — Auchan refresh (EM CURSO)

Lançado `node src/auchanIndex.js --refresh` (`auchan_refresh_sep9_v1.log`) - 23168 produtos, 95,7% obsoletos, o maior dos três. Mesma retoma-recente já validada nos dois anteriores. Utilizador confirmou explicitamente que este trabalho não tem risco de repetir o susto de egress (o refresh só escreve linhas pequenas em `prices`, ~100-200 bytes cada, nada a ver com "Cached Egress" que foi imagens da app) e autorizou deixar a correr durante a noite - vou continuar a relançar sem perguntar até isto (e depois o Auchan) estarem 100%.

**Sessão caiu durante a noite** (o processo Claude Code em si, não só a corrida) - a corrida do Auchan é filha desta sessão, morreu junto. Isto explica melhor as mortes "misteriosas" de ontem (exit 4, exit 0 sem resumo) - provavelmente não era um limite de duração fixo da plataforma, era a sessão a reiniciar. Progresso real feito antes da queda: Auchan 95,7%→42,2% obsoletos. **Relançado outra vez** (`auchan_refresh_sep9_v2.log`) na manhã seguinte, a pedido do utilizador ("já é de manhã, deixei o PC ligado"). Se a sessão voltar a cair, a retoma-recente protege o progresso já feito, mas alguém (utilizador ou uma nova sessão) tem de relançar manualmente - não há mecanismo automático fora desta conversa.

Mais 2 relançamentos (v2 morreu a meio, v3 **terminou com sucesso total**: 26629/26629, 17080 guardados, 8 erros). `checkStaleness.mjs`: Auchan **95,7%→10,0% obsoletos >14 dias**. **Passo 3 fechado.**

**Bug novo encontrado nos 8 erros**: `duplicate key value violates unique constraint "products_barcode_key"` - GTIN repetido entre duas linhas de produto diferentes (Auchan re-lista o mesmo produto físico com SKU novo, mantendo o código de barras de uma linha antiga já na BD). Raro (8/17124, 0,05%), mas bloqueava a atualização inteira desse produto (preço incluído) por causa só do campo `barcode`. **Corrigido**: `auchanIndex.js` agora tenta o `update` outra vez sem o `barcode` se falhar por esta constraint específica - o resto da atualização já não fica refém de uma colisão rara de GTIN. Não investiguei a fundo a causa raiz (SKUs duplicados do lado do Auchan) - fica documentado, não é bloqueante.

## Resumo do estado das 3 lojas (todas refrescadas)

| Loja | Antes | Depois |
|---|---|---|
| Pingo Doce | 45,7% obsoletos | 3,6% |
| Continente | 50,2% obsoletos | 22,9% |
| Auchan | 95,7% obsoletos | 10,0% |

## Passo 4/5 — Apóstrofo + matching (FEITO)

Impacto isolado do fix do apóstrofo (mesmos dados frescos, só o código a diferir - `matchLib.mjs` com vs sem `dropApostrophes`): **+88 ganhos, -11 perdidos** (líquido +77). Ganhos claramente corretos (Ben & Jerry's, M&M's, Jack Daniel's, Cookie'z, 3D's - nomes com apóstrofo, score sobe para 1,0). Os 11 perdidos são todos pares "Detergente A+..." no limiar do threshold (0,75-0,857), mesma família de produto nos dois lados - ruído de fronteira, não regressão (nenhum caso de produtos diferentes emparelhados por engano).

`matchAll.mjs` + `insertMatchesAll.mjs` corridos com dados 100% frescos (as 3 lojas refrescadas + fix do apóstrofo): **96 matches novos, 5129 atualizados, 174 novos para revisão manual.**

## Passo 6 — Fila de revisão

6438 entradas pendentes: 3081 "provável match" (47,9%), 1127 "suspeito preço/unidade" (17,5%), 2230 "sem dados suficientes para classificar" (34,6%), 0 "suspeito quantidade diferente". Estimativa de revisão manual item a item: **~14-24h** de trabalho contínuo. As melhorias propostas ao `reviewMatches.mjs` numa sessão anterior (ordenar por impacto de preço, mostrar imagens lado a lado, agrupar por marca) continuam por implementar - cortariam este tempo significativamente, ficam como próximo passo natural se o utilizador quiser investir nisso.

## Passo 7 — Fecho

| Loja | Baseline (Passo 0) | Final |
|---|---|---|
| Pingo Doce | 45,7% obsoletos | **3,6%** |
| Continente | 50,2% obsoletos | **22,9%** |
| Auchan | 95,7% obsoletos | **10,0%** |
| Lidl | 84,9% obsoletos | 84,9% (fora do âmbito desta sessão) |
| Aldi | 41,1% obsoletos | 41,1% (fora do âmbito desta sessão) |

**Plano completo (Passos 0-7) fechado.** Nenhum commit/push feito - tudo fica no disco à espera de revisão e autorização.

### Ficheiros novos/alterados nesta sessão
- `scripts/checkStaleness.mjs` (novo) - relatório de frescura por loja, reutilizável.
- `scripts/matchLib.mjs` - `dropApostrophes()` + reordenação da normalização de nome.
- `src/auchanIndex.js`, `src/continenteSitemapIndex.js` - modo `--refresh` corrigido para retomar por "atualizado recentemente" (90min) em vez de "revisitar tudo cegamente" ou "já existe" - motivado por múltiplas mortes de tarefas em background/quedas de sessão durante a noite.
- `src/pingoDoceClient.js`, `src/pingoDoceIndex.js` - mesma lógica de retoma-recente (Pingo Doce não tinha nenhuma antes).
- `src/auchanIndex.js` - resiliência a colisão rara de GTIN duplicado (`products_barcode_key`) - tenta o update outra vez sem o barcode em vez de falhar a atualização inteira.

### Decisões/investigações pendentes (não bloqueantes)
1. Colisão de GTIN duplicado no Auchan (8 casos vistos) - resiliência aplicada, causa raiz (SKUs duplicados do lado do Auchan) não investigada a fundo.
2. Melhorias ao `reviewMatches.mjs` (ordenar por impacto, imagens, agrupar por marca) - propostas, não implementadas.
3. Lidl e Aldi continuam obsoletos (84,9% e 41,1%) - fora do âmbito desta sessão, ficam para uma próxima.
4. Diagnóstico dos 2122 padrões de breadcrumb "sem_classificação" do Continente (pendente de sessões anteriores) - o Continente voltou a estar acessível, mas isto não foi retomado nesta sessão (focada em frescura/matching).

---

# Resumo da sessão — correções da auditoria de preços — 2026-08-20 (tarde)

Sessão autónoma, ~2h, utilizador ausente. Regra mantida: **nenhum commit/push foi feito.** Ordem seguida: a recomendada na auditoria de preços desta mesma sessão (ver secção anterior, "Resumo da sessão — 2026-08-20").

## Lição aprendida (não tentar outra vez sem sinal novo)

**Qualquer heurística baseada em preço para detetar erros de match em pares proxy+proxy é circular por construção.** A quantidade "proxy" deriva do próprio preço (`qty = preço ÷ preço-por-unidade`) — por isso qualquer métrica de "o preço/preço-por-unidade diverge muito" vai correlacionar quase perfeitamente com "o preço total diverge muito", porque são quase a mesma conta feita duas vezes. Confirmado nesta sessão: testei um gate de divergência de €/unidade, pareceu excelente (98,1% apanhados, 0% de custo), mas era artefacto da definição — diferença média entre as duas métricas de só 0,19 pontos percentuais, e um penhasco na curva exatamente no limiar usado para definir "mau" (ver ponto 5 abaixo para o detalhe completo).

**Só resolve com sinal independente do preço:**
- EAN/GTIN (nenhuma loja atual tem cobertura suficiente para isto ainda — ver auditoria, Parte A)
- Peso/volume real extraído do nome dos dois lados (não proxy) — já funciona bem quando existe (ver Parte C3 da auditoria: pares weight+weight ou volume+volume)
- Revisão humana (fila de revisão — ver ponto 2 abaixo, deixou de ser dívida temporária)

Antes de propor outra heurística de preço para este problema, verificar primeiro se ela não é matematicamente equivalente ao preço que já se está a tentar validar.

## 1. Fix regex de fraldas (CONCLUÍDO, gravado na BD)

**Problema:** `extractQuantity()` (`src/quantityExtractor.js` e a cópia em `scripts/matchLib.mjs`) lia o intervalo de peso do bebé no nome ("Fraldas 9-15kg T4") como se fosse o peso da embalagem — 15kg em vez de nenhuma quantidade real.

**Fix:** novo `WEIGHT_RANGE_RE` remove padrões `\d+-\d+kg`, `<Nkg`, `+Nkg` do nome *antes* de correr `QTY_RE`, nos dois ficheiros. Corrigido de forma genérica (não específica a "fralda") — apanha também a mesma classe de bug fora de fraldas: 4 "cuecas de banho/noite" (Auchan, mesmo padrão de peso de bebé) e 3 "ossos" de cão com peso do próprio produto expresso como intervalo (regressão teórica mínima, população de 3, aceitável — antes também liam o valor superior do intervalo como exato).

**Validado:**
- 281 produtos-fonte confirmados (120 Continente + 90 Auchan + 71 Pingo Doce) — 0 continuam a devolver peso falso depois do fix.
- Sem regressão: quantidades reais continuam a extrair certo ("Leite Meio Gordo 1L", "Iogurte 4x125g", "Ração Cão 10-25kg Pedigree 15kg" → extrai 15kg corretamente, ignorando só o intervalo).
- Matching re-corrido (`matchAll.mjs` + `insertMatchesAll.mjs`): pares fralda/cueca **77 → 61** (16 desapareceram por completo, deixaram de ser considerados o mesmo produto); dos que restam, spread de preço >50% **33 → 5**. Os 5 restantes já não são o bug do intervalo — caem no fallback proxy (mesma limitação estrutural documentada no ponto 5).
- **15 matches já aprovados (`confidence=high`) que deixaram de validar sob a lógica nova foram movidos para `matched_products_review` com `status='reaudit_pending'`** (nunca apagados sem rasto) via `reaudit_fraldas_range_bug.mjs`, seguindo o precedente já existente em `reaudit_frutas_legumes.mjs`. 0 erros.
- Totais atuais na BD: 4746 `matched_products`, 4604 em `matched_products_review` (22 `reaudit_pending`, incluindo os 15 novos + 7 de uma reaudit anterior de frutas_legumes).

## 2. GTIN do Auchan (parser corrigido, re-scrape em curso)

**Fix:** `src/auchanClient.js` agora lê `product.gtin13 || product.gtin || product.gtin12 || product.gtin8 || product.gtin14` do ld+json (antes só lia `sku`). `src/auchanIndex.js` grava em `products.barcode` (insert e update).

**Re-scrape para preencher os 22002 produtos existentes:** lançado em background (`auchan_gtin_rescrape.log`), 30433 URLs no sitemap, ao ritmo novo (concurrency=2/delayMs=1000, conforme pedido — "não tenhas pressa"). **Não vai terminar dentro das ~2h desta sessão** — a ~1,5-1,7 req/s, 30433 URLs ≈ 5-6h. Deixei a correr; o processo é retomável (a lógica de retoma do Continente não existe no Auchan atual, por isso esta corrida reprocessa tudo, não só o que falta — se for interrompida, terá de recomeçar do zero ou seria preciso portar a lógica de retoma do `continenteSitemapIndex.js`).
**Resultado real:** a corrida **parou a meio** (sem erro, sem bloco de resumo final — provável limite de duração da tarefa em background, não um bug no código). Cobertura final desta corrida: **11195/22170 produtos Auchan (50,5%) com GTIN preenchido.**

**Decisão do utilizador: não relançar agora.** GTIN do Auchan não tem utilidade enquanto não soubermos se o Continente também expõe GTIN — nenhuma outra loja tem EAN para cruzar (Pingo Doce/Aldi confirmados sem EAN, Lidl ~1%). Completar de 50% para 100% não muda nada hoje.

**PRÓXIMO PASSO CONDICIONAL (quando o Continente desbloquear) — fazer isto primeiro, antes de qualquer outra coisa relacionada com EAN:**
1. Verificar se as páginas de produto do Continente expõem GTIN/EAN (mesmo teste já feito ao vivo para Auchan/Pingo Doce/Aldi/Lidl nesta sessão — ver auditoria, Parte A1).
2. **Se sim**: completar o re-scrape do Auchan (retoma agora disponível, ver abaixo — só processa os que faltam, não os 22170 já feitos) e o par Continente×Auchan passa a ser verificável por EAN (3035 matches, o maior par).
3. **Se não**: o GTIN parcial do Auchan fica como está, indefinidamente, e o assunto EAN encerra-se — não há mais nenhum caminho realista para verificação por EAN nesta BD (ver teto documentado na auditoria, Parte 5).

## 2b. Lógica de retoma portada para o Auchan (CÓDIGO PRONTO E TESTADO, NÃO LANÇADO)

Motivada diretamente pelo incidente acima — o Auchan não tinha lógica de retoma, por isso a corrida interrompida não pode ser completada de forma barata. Portado o mecanismo do `continenteSitemapIndex.js` para `src/auchanIndex.js`: `getExistingExternalIds()` lê todos os `external_id` já na BD para a loja, e filtra os URLs do sitemap antes de começar — uma corrida futura só processa o que falta, não os 22170 já feitos.

**Testado ao vivo (só a lógica de filtragem, sem lançar o scrape completo, conforme pedido):** 30433 URLs no sitemap, 22170 já na BD, **8854 por processar** — número faz sentido e confere com o estado atual.

**Nota importante sobre o que este mecanismo NÃO faz** (mesma limitação já documentada no Continente): serve para retomar uma *descoberta de catálogo* interrompida — produtos já na BD não são revisitados, por isso não serve para atualizar preços do dia a dia (isso precisa de uma corrida normal, sem filtro, que revisite tudo). Também não teria ajudado a *completar* o backfill de GTIN de hoje especificamente, porque os produtos já na BD (sem GTIN ainda) ficam de fora do filtro — só ajuda corridas de descoberta de produtos novos, não de preenchimento de campo novo em produtos já existentes.

**Confirmação pedida — estado de retoma nos outros scrapers:**
| Loja | Tem lógica de retoma? |
|---|---|
| Continente (sitemap+PDP) | Sim (já existia) |
| **Auchan** | **Sim (portada agora)** |
| Pingo Doce | Não |
| Lidl | Não (catálogo pequeno, 137-276 produtos — impacto de reprocessar do zero é de minutos, não horas) |
| Aldi | Não (catálogo pequeno, 165-303 produtos — mesma razão, e já documentado no próprio código: "sem necessidade da lógica de retoma/lotes usada no Auchan") |

Pingo Doce (~9823 produtos) é o único caso intermédio sem retoma — não portei (não foi pedido, e o impacto de uma corrida interrompida é bem menor que Continente/Auchan), mas fica identificado como o próximo candidato natural se for preciso.

## 3. Bug 0,01€ no Pingo Doce (CONCLUÍDO, gravado na BD)

**Investigação:** busquei ao vivo as páginas dos 9 produtos afetados. **Não é bug de parsing nosso** — o próprio site do Pingo Doce serve `content="0.01"` no ld+json/GTM para estes produtos, ao vivo, confirmado. Padrão: a maioria (5/9) são produtos de balcão (padaria, peixaria, talho) vendidos a peso na loja física, sem preço fixo online — o 0,01€ é um placeholder do retalhista para "não vendável online". Os outros 4 (sabonete, detergente, iogurte, salsichas) — pelo menos um confirmado como 301 (produto descontinuado/movido, já não tem página válida).

**Fix:** novo `MIN_PRODUCT_PRICE = 0.05` em `src/pingoDoceClient.js`, aplicado em `src/pingoDoceIndex.js` junto ao filtro `MAX_PRODUCT_PRICE` já existente — preços fora deste intervalo passam a ser ignorados (não gravados), tal como já acontecia para preços ≥100€.
**Limpeza dos 9 casos existentes:** apagadas as 19 linhas de `prices` a 0,01€, anulados `current_price`/`current_price_per_unit` nos 9 `supermarket_products` afetados (deixam de aparecer com preço errado até uma corrida futura os re-encontrar — se ainda existirem, o filtro novo vai simplesmente ignorá-los de novo, o que é o comportamento correto).
**Âmbito verificado:** os 19 casos <0,10€ na BD eram TODOS exatamente 0,01€ e TODOS Pingo Doce — não encontrei outros valores "menos óbvios" errados na mesma rota de parsing.

## 4. Vinhos do Continente — hipótese documentada (SÓ INVESTIGAÇÃO, Continente continua bloqueado)

Cruzei os 103 pares Continente×outra-loja com `subcategory='vinho'` e ratio de preço >2x (Continente sempre o lado caro — direção consistente, não aleatória: 103 casos >2x caro vs só 10 casos <0,5x barato).

**Resultado — duas causas distintas, não uma:**
- **70/103 (68%)**: `subcategory_source='nome'` (o backfill desta sessão) **e** `supermarket_products.updated_at` de **04 Ago** — os produtos mais antigos da BD, de antes da reescrita para sitemap+PDP. Staleness confirma-se como causa direta para esta maioria.
- **30/103 (29%)**: `subcategory_source='breadcrumb'`, capturados entre 07 Ago e **hoje** (20 Ago, inclui capturas de há poucas horas) — **estes são frescos e continuam anómalos.** Staleness não explica esta fatia. Sem indício de "caixa"/"pack"/"garrafas" no nome (não é confusão caixa-vs-garrafa óbvia). Duas hipóteses em aberto, não distinguíveis sem aceder ao Continente: (a) o Continente genuinamente cobra mais por vinhos reserva/vintage do que a concorrência nestes casos específicos (não seria bug), ou (b) o mesmo mecanismo de preço de cartão/promoção da Parte B1 da auditoria (ld+json pode estar a expor o preço de tabela pré-desconto).

**Recomendação:** quando desbloquear, verificar ao vivo uma amostra dos 30 casos frescos primeiro — resolve a ambiguidade (a) vs (b) rapidamente.

## 5. Prototipagem do fallback proxy — RESULTADO NEGATIVO para a heurística pedida, alternativa encontrada (NADA APLICADO)

**Heurística pedida (score de nome mais exigente para proxy+proxy) — testada e não funciona:**
Score médio dos 154 pares maus (spread>50%) = 0,902; score médio dos 1704 bons = 0,914 — **basicamente indistinguível**. 82/154 (53%) dos maus têm score=1,0 (nomes literalmente idênticos, ex. "Offley Vinho do Porto Tawny" self-match). Subir o limiar de score remove maus e bons a taxas quase iguais:

| Limiar score | Maus removidos | Bons perdidos |
|---|---|---|
| 0,80 | 18,8% | 16,1% |
| 0,85 | 43,5% | 35,6% |
| 0,90 | 46,8% | 43,1% |
| 0,95 | 46,8% | 43,3% |

Não há "sweet spot" — a curva sobe quase em paralelo. **Conclusão: o nome não é o sinal que falta; o nome já está correto nestes casos, o problema é preço/quantidade.**

**Alternativa encontrada e testada (não pedida, mas decorre diretamente do resultado acima):** o código já tem um gate de divergência de preço/unidade (`ppuDivergesTooMuch`), mas está desligado quando os dois lados têm a mesma marca real (`sameRealBrand`) — exatamente o caso dos vinhos/Offley. Testei aplicá-lo também a pares proxy+proxy independentemente da marca:

| Limiar divergência €/unidade | Maus apanhados | Bons perdidos |
|---|---|---|
| 15% | 100,0% | 24,1% |
| 30% | 100,0% | 13,0% |
| **50%** | **98,1% (151/154)** | **0,0% (0/1704)** |
| 100% | 11,7% | 0,0% |

**Recomendação original (50% divergência €/unidade) — RETIRADA após validação pedida pelo utilizador.** A validação não aguentou:
- **Circularidade confirmada**: "maus" foi definido como spread de preço >50%; o gate mede divergência de €/unidade. Como a quantidade proxy já bate a ~0,15% entre os dois lados de qualquer par (por construção: `qty = preço ÷ €/unidade`), `spread_de_preço ≈ divergência_€/unidade` quase algebricamente — diferença média absoluta de só 0,19 pontos percentuais entre as duas métricas nos 1858 pares testados. A curva de limiares confirma um penhasco exatamente no limiar usado para definir "mau" (98,1%/0% a 50%, mas cai para 46,8%/0% a 60% e 28,6%/0% a 70% — não é um sinal robusto, é a definição a repetir-se).
- **Controlo `confidence='manual'`**: só 3 matches manuais existem na BD, e só 1 é proxy+proxy (Atum Tenório/Aldi, divergência 26,5% — não seria rejeitado a 50%, mas n=1 não prova nada).
- **Amostra de 10 exemplos que o gate rejeitaria**: uma mistura — alguns claramente embalagens diferentes (Ice Tea Pack 6, Água Pack 4), mas de todos os 151 casos rejeitados a 50%, só 9 (6%) têm "pack"/"Nx" no nome; os outros 142 não têm sinal textual de embalagem diferente, e vários (ex. "Refrigerante Joi Laranja" 2,05€ vs 1,29€, "Café Solúvel Clássico Nescafé" 3,99€ vs 6,29€) parecem ser o mesmo produto com preço genuinamente diferente entre lojas, não um erro de match.

**Conclusão: NÃO aplicado.** O "0% de custo" era artefacto da definição circular, não validação real. O que sobrevive, mais modesto: pares proxy+proxy com spread de preço >50% hoje entram em `matched_products` sem nenhum travão de preço (528 casos, já conhecido da auditoria) — mas não há forma de separar, só com estes dados, quantos são erro real vs. produto igual com preço genuinamente muito diferente entre lojas.

## 6. Multipack "Pack N" (avaliado, não implementado)

Não dá para inferir o tamanho individual de forma fiável nestes casos: "Pack N" sem número de tamanho individual no nome. O único caminho seria `tamanho_individual = (preço ÷ preço-por-unidade) ÷ N` — mas preço-por-unidade × quantidade já É o mecanismo "proxy" que o matching já usa para a quantidade TOTAL da embalagem. Extrair o tamanho individual não mudaria nenhum resultado de matching (o que importa para comparar preços é a quantidade total, que o proxy já captura razoavelmente bem quando o preço-por-unidade é de confiança). **Conclusão: irrecuperável de forma que compense o esforço — não é um gap de engenharia, é a mesma limitação estrutural do ponto 5.**

## Proposta: melhorar `reviewMatches.mjs` (NÃO IMPLEMENTADO, só proposta)

Consequência do ponto 5: a fila de revisão manual deixou de ser dívida temporária, é parte permanente do processo (ver "Lição aprendida" no topo). Levantei o que dava para melhorar sem inventar dados que não temos:

1. **Ordenar por impacto económico, não por loja/nome (ordem atual).** Não temos dados de vistas/pesquisas (confirmei — não existe nenhuma coluna de popularidade/contagem em `products` nem em nenhuma tabela do scraper; seria um sinal do lado da app, fora deste repositório). O proxy disponível **hoje**, sem inventar nada: `|price_a - price_b|` em euros — rever primeiro os 100 pares com maior diferença absoluta de preço tem mais impacto no utilizador final do que rever por ordem alfabética de loja. Simples de fazer, dados já existem na própria linha.
2. **Mostrar as imagens, não só os URLs.** `matched_products_review` já tem `image_url_a`/`image_url_b` (migração 014) mas `printEntry()` nunca os imprime — só imprime `url_a`/`url_b` (a página do produto, não a imagem). Gap fácil de fechar: imprimir os dois URLs de imagem lado a lado, e opcionalmente abrir os dois no browser por defeito com um comando do sistema, para comparação visual num segundo sem sair do terminal.
3. **Sinalizar o nível de ambiguidade real, não só o score.** Distinguir na listagem se o par é proxy+proxy (sem sinal independente — decisão exige mais atenção) vs weight+weight/volume+volume (quantidade real confirmada dos dois lados — normalmente mais rápido de decidir, mesmo que o preço divirja). Isto orienta a atenção do revisor para onde a incerteza é genuína, em vez de gastar o mesmo tempo em todos.
4. **Agrupar candidatos semelhantes para decidir em lote.** Ordenar/agrupar por `(brand, categoria)` — rever todos os "Nescafé" ou todos os "Fraldas Dodot" seguidos, em vez de intercalados com produtos não relacionados, ajuda a manter o contexto e decidir mais depressa em sequência.

Nenhuma destas mudanças precisa de dados novos — tudo já está na tabela `matched_products_review`. Fica para decidires quais destas (todas, algumas, nenhuma) implementar.

## Decisões que ficam para ti

1. **Gate de divergência €/unidade — retirado após validação pedida.** Confirmado circular (ver ponto 5 acima). Não há proposta viável no momento para separar "erro de match" de "produto igual com preço genuinamente diferente" só com os dados atuais — precisaria de sinal independente de preço (EAN, ou revisão manual de amostra).
2. **Vinhos do Continente**: aceite pelo utilizador — 68% (staleness) resolve-se sozinho no próximo re-scrape; os 29% frescos ficam com a hipótese documentada, sem ação agora.
3. ~~Re-scrape do Auchan para GTIN~~ — **resolvido**: parou a meio (50,5% de cobertura), decisão do utilizador foi não relançar agora. Ver ponto condicional em "2. GTIN do Auchan" acima.
4. ~~Portar lógica de retoma para o Auchan~~ — **feito** (ponto 2b acima), testado, não lançado.

---

# Resumo da sessão — 2026-08-20

Sessão autónoma. Regra mantida: nenhum commit/push foi feito.

## Trabalho desta sessão (resumo)

- Backfill pontual de subcategoria por nome para ~4964 produtos de bebidas do Continente sem breadcrumb (vinho/garrafeira) — ver `src/bebidasNameClassifier.js`, `backfillBebidasSubcategoryByName.mjs`, migração `supabase/020_products_subcategory_source.sql` (nova coluna `products.subcategory_source`: `'breadcrumb'` | `'nome'`, aplicada pelo utilizador).
- Matching + `insertMatchesAll.mjs` re-corridos após o backfill: 0 novos matches/revisão (já existiam de corrida anterior), 4032 linhas atualizadas com a subcategoria agora preenchida. Totais confirmados: 4743 `matched_products`, 4541 em `matched_products_review`.
- **Bloqueio do Continente (HTTP 474 "Request Blocked", Link11 WAF)**, provável causa: corrida do sitemap+PDP de 19 Ago a ~3,16 req/s (concurrency=10/delayMs=150, 7823 pedidos em 41 min). Decisão do utilizador: não contornar (sem mudar UA/headers, sem acelerar), esperar desbloqueio natural.
- Diagnóstico pendente (bloqueado até desbloquear): padrões de breadcrumb dos 2122 produtos "sem_classificacao" da corrida de 19 Ago — script pronto em `diag_breadcrumb_patterns.mjs` (só leitura, não usa a BD).
- Ritmo de scraping tornado configurável por variável de ambiente em todos os 5 clientes (`src/continenteClient.js`, `src/auchanClient.js`, `src/aldiClient.js`, `src/pingoDoceClient.js`, `src/lidlClient.js`), com defaults muito mais conservadores — ver secção "Ritmo de scraping" abaixo. Confirmado: o Auchan usava os mesmos defaults (10/150ms) que bloquearam o Continente, com catálogo ainda maior (30000+ URLs) — nunca chegou a bloquear por sorte/ordem de execução, não por estar seguro.

## Ritmo de scraping — valores por defeito (env var override)

| Loja | Env vars | Defaults novos | Defaults antigos |
|---|---|---|---|
| Continente (sitemap+PDP) | `CONTINENTE_CONCURRENCY`, `CONTINENTE_DELAY_MS` | 2 / 1000ms | 10 / 150ms |
| Auchan | `AUCHAN_CONCURRENCY`, `AUCHAN_DELAY_MS` | 2 / 1000ms | 10 / 150ms |
| Aldi (catálogo pequeno, 303 URLs — risco de volume baixo) | `ALDI_CONCURRENCY`, `ALDI_DELAY_MS` | 4 / 300ms | 5 / 200ms |
| Pingo Doce (sequencial) | `PINGODOCE_DELAY_MS` | 750ms | 350ms |
| Lidl (sequencial, catálogo pequeno) | `LIDL_DELAY_MS` | 750ms | 200ms |

## Notas para o futuro (registadas por pedido explícito do utilizador)

1. **Corridas completas de catálogo devem passar a ser eventos raros e planeados, não rotina.** O dia-a-dia deve ser atualização de preços dos produtos já conhecidos (muito mais leve que descobrir catálogo de novo) — evita repetir o volume de pedidos que já causou o bloqueio do Continente.
2. **Vale a pena implementar deteção de bloqueio** (HTTP 403/429/474, e variantes de WAF) que pare a corrida automaticamente em vez de continuar a insistir — para não agravar um bloqueio como aconteceu com o Continente. Não implementado ainda, é trabalho futuro.

---

# Resumo da sessão — correção qtyMatches + reescrita Auchan (sitemap) — 2026-08-17

Sessão autónoma. Regra mantida: nenhum commit/push foi feito.

## 1. Fase 1 — fix qtyMatches (CONCLUÍDO, gravado na BD)

**Problema:** `qtyMatches()` em `scripts/matchLib.mjs` comparava quantidade "proxy" (price/pricePerUnit, escala kg/L) diretamente contra quantidade real extraída do nome (escala g/ml), rejeitando produtos idênticos por "99% de diferença".

**Fix aplicado:** escala o proxy ×1000 antes de comparar contra uma quantidade real de peso/volume (`scaleProxyToBaseUnit`). Ficheiro: `scripts/matchLib.mjs`.

**Resultado, corrido e gravado via `matchAll.mjs` + `insertMatchesAll.mjs`:**
- 314 novos `matched_products` inseridos, 1784 atualizados (subcategoria/confiança/preço) no total entre as duas corridas.
- 3170 preços poupados (sem mudança desde o último registo).
- Confirmado: "Néctar 8 Frutos Um Bongo" agora casa score 1.0 com as 3 variantes Auchan (era o caso original reportado).

**Bug secundário encontrado e corrigido durante esta fase:** insert em lote de `matched_products_review` falhava por inteiro quando uma linha tinha `price_a`/`price_b` null (19 produtos Auchan na BD têm preço null, herdados de antes do guard anti-NaN existir no scraper). Corrigido em `scripts/insertMatchesAll.mjs`: filtra linhas com preço null antes do insert, loga quantas foram saltadas, não perde as restantes.

## 2. Fase 2 — reescrita Auchan sitemap+PDP (IMPLEMENTADO, **NÃO CORRIDO EM PRODUÇÃO**)

**Motivo original:** scraper antigo só lia páginas de categoria estáticas (~24 produtos), perdendo produtos em 380/752 categorias (50%) que têm mais.

**Investigação:** `robots.txt` do Auchan expõe `Sitemap: https://www.auchan.pt/sitemap_index.xml`, com `sitemap_0-product.xml` + `sitemap_1-product.xml` = 60065 URLs de produto, sem paginação bloqueada. Página de produto individual tem tudo num `<script type="application/ld+json">`: nome, marca, SKU, GTIN, imagens, preço, disponibilidade, breadcrumb de categoria (3 níveis).

**Implementado:**
- `src/auchanClient.js` reescrito: `collectRelevantProductUrls()` lê o sitemap e filtra pelos prefixos das 752 categorias já curadas (`CATEGORY_URLS`); `fetchAuchanProducts()` processa em lotes com concorrência 10 e 150ms de intervalo entre lotes.
- `src/auchanIndex.js` ajustado para o novo callback (`onProductError`/`onProgress`).
- `classifyAuchanBreadcrumb` (em `auchanCategoryMap.js`) já tolerava 3 níveis sem alteração (usa `.filter(Boolean)`).

**Amostra de validação (50 produtos, script `diag_auchan_sample.mjs`):**
- 30403 URLs relevantes encontrados no sitemap (vs ~9570 produtos atualmente na BD — potencial de 2-3x mais cobertura).
- Tempo estimado para corrida completa: **~69 minutos** (concorrência 10, 136ms/produto médio).
- 0 erros de rede na amostra. Preços, imagens e nomes corretos em todos os 50.

**BLOQUEIO — não avancei para a corrida completa, por instrução explícita ("se a amostra tiver problemas, não avances"):**
Encontrei 2 classificações erradas na amostra (categoria/subcategoria, não afeta nome/preço/imagem):
- "FORTIFICANTE OVOMALTINE 400G" → classificado `talho_peixaria/marisco` (devia ser mercearia/chocolates). Causa: regra `/marisco|camarao|lulas|polvo|choco/i` apanha "choco" dentro de "achocolatados".
- "CALDO KNORR GALINHA/CARNE" → classificado `talho_peixaria/peixe_fresco`. Causa: regra `/peixaria|peixe|bacalhau|salmao/i` apanha "peixe" dentro do nome da categoria genérica Auchan "Caldo Carne, Peixe e Legumes".

**Importante: confirmei que este bug já existia na BD atual (scraper antigo, baseado em tiles) — não foi introduzido pela reescrita.** Contagem rápida na BD atual: ~17 casos choco→marisco, ~26 casos caldo→peixe_fresco. É um bug pré-existente de colisão de regex (mesma classe de bug já corrigida 2x nesta sessão para outras colisões Lidl/Auchan), mas nunca antes reportado.

**Decisão pendente (só o utilizador pode validar):** quer que eu corrija estas 2 regras em `auchanCategoryMap.js` antes de correr a Fase 2 em produção? É um fix pequeno e no mesmo padrão dos já aplicados (adicionar word-boundary ou reordenar regras), mas pode haver mais colisões semelhantes só visíveis numa amostra maior — sugiro corrigir as 2 conhecidas, correr uma amostra maior (200-300 produtos) para procurar mais casos, e só depois avançar para a corrida completa (~69 min, ~30000 produtos).

Ficheiros de diagnóstico usados (não tocam BD): `diag_auchan_sample.mjs`.

## 3. Migração de imagens para Storage (CONCLUÍDO)

Corri `scripts/uploadImagesToStorage.mjs` (guard anti-clobber já correto de sessão anterior — só migra o que ainda não está no Storage).

**Resultado:** 1456 candidatos de alta confiança com imagem disponível, 363 ainda por migrar (110 continente, 250 pingo-doce, 3 auchan) → **363 migradas com sucesso, 0 erros de upload**. 3 saltadas por host desconhecido: imagens Lidl vêm de `imgproxy-retcat.assets.schwarz` (CDN diferente do que está mapeado em `HOST_TO_STORE`, que só tem `www.lidl.pt`). Afeta só 3 produtos ("Solero Gelado Exótico", "GALLO Azeite Virgem Delicado", "Carte D'Or Gelado Tiramisu") — não corrigi, fica documentado. Fix seria trivial (adicionar o host ao mapa em `scripts/uploadImagesToStorage.mjs`), mas é cosmético/baixo impacto, não bloqueia nada.

## 4. Padrão nos casos qtyMatches ainda não resolvidos (INVESTIGADO, SEM FIX APLICADO)

Depois do fix da Fase 1, ainda há 26933 pares nome+marca parecidos (jaccard≥0.3) sem match. Categorizados por tipo de quantidade dos dois lados:

| Combinação | Casos | Interpretação |
|---|---|---|
| proxy vs proxy | 10451 | Maioria produtos genuinamente diferentes (variantes/origens distintas, ex. café Brasil vs Angola vs Colômbia) — o "proxy" (price/pricePerUnit) é uma estimativa ruidosa, não uma quantidade real, por isso valores próximos não implicam mesmo produto |
| proxy vs volume/weight | 7392 | Mesma coisa — proxy impreciso em casos de embalagem múltipla/pack, mesmo depois de escalado ×1000 |
| weight vs weight | 97 | Tamanhos genuinamente diferentes (ex. ração 10kg vs 1.5kg) — rejeição correta |
| volume vs volume | 7 | Tamanhos genuinamente diferentes (sacos de lixo 130L vs 100L vs 30L) — rejeição correta |

**Conclusão: não encontrei um novo bug sistémico.** O fix da Fase 1 resolveu a classe de erro identificada (escala proxy vs real). O que resta é ruído inerente ao "proxy" como heurística de fallback quando o nome não tem tamanho explícito — precisaria de uma abordagem diferente (ex. melhorar extração de tamanho do nome, ou tolerância de quantidade condicionada a similaridade de nome muito alta) para reduzir mais, mas isso é uma mudança de design maior, não um bug pontual. Não implementei nada aqui, conforme instrução ("não implementes correções adicionais sem eu validar").

## Decisões pendentes (preciso da tua confirmação)

1. **Fase 2**: corrigir as 2 colisões de regex em `auchanCategoryMap.js` (choco→marisco, peixe→peixe_fresco) antes de correr a amostra maior e depois a corrida completa? Ou correr como está e tratar a classificação errada depois?
2. Se quiseres avançar com uma redução mais agressiva do ruído "proxy vs proxy/real" (ponto 4), isso é uma mudança de design maior — decide se vale a pena investir nisso ou se o ganho da Fase 1 já é suficiente.
3. 3 imagens Lidl não migradas por host de CDN desconhecido (`imgproxy-retcat.assets.schwarz`) — fix trivial, baixo impacto, avanço só se quiseres.
4. Nada foi commitado/enviado para o GitHub. Ficheiros novos na raiz do projeto (`diag_qty_bug.mjs`, `diag_remaining_gaps.mjs`, `diag_qty_pattern.mjs`, `diag_auchan_sample.mjs`) — dizer se queres manter ou apagar antes de um eventual commit.

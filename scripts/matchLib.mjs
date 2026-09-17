// Motor de matching de produtos entre duas fontes (extraido de matchProducts.mjs
// para poder ser reutilizado nos 3 pares Continente/Pingo Doce/Lidl sem duplicar
// a logica). Ver matchProducts.mjs (o par original Pingo Doce x Continente) para
// o historico/racional de cada heuristica.
import { pluralForms } from "../src/pluralMatch.js";

const PACK_WORDS = new Set([
  "pack", "un", "uni", "unid", "unidade", "unidades", "embalagem", "emb",
  "garrafa", "lata", "saco", "cx", "caixa", "pacote", "pct", "tabuleiro",
  "bandeja", "frasco", "tina", "tinas", "bolsa", "bolsas", "goma",
]);

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const QTY_RE = /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b|(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/i;

// Intervalos de peso usados como rotulo de tamanho (fraldas "9-15kg", racao
// animal "10-25kg"), nao a quantidade real do produto - ver mesma constante
// em src/quantityExtractor.js para o racional completo.
const WEIGHT_RANGE_RE = /(?:\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?|[<>+]\s*\d+(?:[.,]\d+)?)\s*(?:kg|g|l|ml|cl)\b/gi;

function toBaseUnit(value, unit) {
  const v = Number(String(value).replace(",", "."));
  switch (unit.toLowerCase()) {
    case "kg": return { qty: v * 1000, kind: "weight" };
    case "g": return { qty: v, kind: "weight" };
    case "l": return { qty: v * 1000, kind: "volume" };
    case "cl": return { qty: v * 10, kind: "volume" };
    case "ml": return { qty: v, kind: "volume" };
    default: return null;
  }
}

function extractQuantity(name) {
  const m = name.replace(WEIGHT_RANGE_RE, " ").match(QTY_RE);
  if (!m) return null;
  if (m[1] && m[2] && m[3]) {
    const base = toBaseUnit(m[2], m[3]);
    if (!base) return null;
    return { qty: base.qty * Number(m[1]), kind: base.kind, multiplier: Number(m[1]) };
  }
  if (m[4] && m[5]) {
    const base = toBaseUnit(m[4], m[5]);
    if (!base) return null;
    return { ...base, multiplier: 1 };
  }
  return null;
}

// Apostrofo removido (nao virado espaco) - "D'Or" -> "dor", junta as letras
// tal como uma loja que escreve "DOr" sem apostrofo nenhum. Se virasse
// espaco ("d or") nunca bateria certo com "dor" (uma palavra so).
function dropApostrophes(s) {
  return s.replace(/['’]/g, "");
}

function normalizeName(name, brand) {
  let s = dropApostrophes(stripAccents(name.toLowerCase()));
  s = s.replace(QTY_RE, " ");
  // Resto da pontuacao removida ANTES de tentar tirar a marca do nome -
  // senao "Carte D'Or" (marca) nunca apanhava "Carte DOr" (repetido no nome
  // de uma loja sem apostrofo), sobrava como ruido nos tokens e baixava o
  // score de nomes identicos (ex. "Gelado Tiramisu Les Desserts Carte DOr"
  // vs "Gelado Tiramisu Les Desserts" - mesmo produto, ficava preso na fila
  // de revisao com score 0.667 em vez de aparecer direto na app).
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (brand) {
    const brandClean = dropApostrophes(stripAccents(brand.toLowerCase())).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (brandClean) s = s.replace(brandClean, " ");
  }
  s = s.replace(/\s+/g, " ").trim();
  const tokens = s.split(/\s+/).filter((t) => t && !PACK_WORDS.has(t) && !/^\d+$/.test(t));
  return { tokens, normalizedText: s };
}

// Palavras que uma so das duas pontas pode ter, e que tornam o produto
// DIFERENTE (nao um simples sinonimo) - ver src/searchSynonyms.js para o
// mecanismo irmao/oposto (SEARCH_SYNONYM_GROUPS agrupa palavras
// EQUIVALENTES para a pesquisa; aqui e o contrario, palavras que
// desqualificam um match quando so aparecem de um lado). diverges() ja
// aplicava esta logica a FLAVOR_WORDS/VARIANT_WORDS - as adicoes abaixo
// (auditoria de precos: "Alpro Soja Sem Acucar" a emparelhar com "Alpro
// Soja" normal, informacao de saude errada, nao so erro de preco) reusam o
// mesmo pluralForms() ja usado nos classificadores de breadcrumb, para nao
// escrever regex novo por palavra.
function wordAndPlurals(...words) {
  const set = new Set();
  for (const w of words) for (const form of pluralForms(w)) set.add(form);
  return set;
}

const FLAVOR_WORDS = new Set([
  "natural", "queijo", "chilli", "chili", "picante", "fumado", "defumado",
  "morango", "chocolate", "baunilha", "caramelo", "caramel", "manga",
  "limao", "laranja", "ananas", "framboesa", "mirtilo", "maracuja",
  "pistacio", "avela", "cafe", "canela", "mel", "coco", "banana", "amora",
  "cereja", "pera", "maca", "uva", "kiwi", "pessego", "tutti", "frutis",
  "menta", "gengibre", "alho", "cebola", "cebolinho", "chalota", "ervas",
  "alecrim", "oregao", "manjericao", "tomilho", "curcuma", "curry", "caril",
  "wasabi", "soja", "amendoim", "pistachio", "salgado", "salgada", "doce", "acido",
]);
// "suave" e "torrado" ficaram de fora (testados e revertidos - ver
// SESSAO_RESUMO): "suave" aparece em nomes de escovas de dentes como
// reforco redundante de "Soft"/"Slim Soft", nao como par oposto de
// picante fora do contexto alimentar - falso positivo. "torrado":
// produtos de marcas so-congelados (Iglo/Pescanova/Bonduelle) tem
// "Torrado"/"Congelados" no nome so de um lado, sem ser diferenca real.

const VARIANT_WORDS = new Set([
  "light", "zero", "integral", "magro", "magra", "gordo", "gorda",
  "desnatado", "desnatada", "meio", "meia",
  "bio", "organico", "organica", "biologico", "biologica", "diet",
  "reforcado", "reforcada", "extra", "premium",
  "tradicional", "classico", "classica", "original", "artesanal",
  "caseiro", "caseira", "cremoso", "cremosa",
  // descafeinado/vegetariano/halal: dieta/composicao, mesma familia de
  // "bio"/"diet" acima - diferenca real de produto, nao so de nome.
  // cru/cozido: estado de preparacao, critico em peixaria/talho (ex.
  // "Camarao Cru" vs "Camarao Cozido" nao sao intercambiaveis - risco de
  // seguranca alimentar, nao so de preco). "congelado"/"fresco"/"vegan"
  // ficaram de fora (testados e revertidos - ver SESSAO_RESUMO):
  // "congelado" so aparece de um lado em marcas ja-so-congelados
  // (Iglo/Pescanova/Bonduelle), sem ser diferenca real; "vegan" apanhou
  // "Planteiga com Sal" (marca ja vegetal por definicao) - falso positivo
  // por nao distinguir "descreve o produto" de "produto diferente".
  ...wordAndPlurals(
    "descafeinado", "descafeinada", "vegetariano", "vegetariana", "halal",
    "cru", "crua", "cozido", "cozida"
  ),
]);

// alcool/pele/espinha seguem o mesmo padrao "sem X"/"com X" das nouns ja
// existentes (gluten, acucar, lactose, sal...) - ver polarityFlags abaixo.
const POLARITY_NOUNS = ["gluten", "acucar", "lactose", "sal", "gordura", "cafeina", "conservantes", "corantes", "alcool", "pele", "espinha"];

function polarityFlags(text) {
  const flags = {};
  for (const noun of POLARITY_NOUNS) {
    if (new RegExp(`sem\\s+${noun}`).test(text)) flags[`sem_${noun}`] = true;
    else if (new RegExp(`com\\s+${noun}`).test(text)) flags[`com_${noun}`] = true;
  }
  return flags;
}

function diverges(tokensA, tokensB, wordSet) {
  const setA = new Set(tokensA.filter((t) => wordSet.has(t)));
  const setB = new Set(tokensB.filter((t) => wordSet.has(t)));
  for (const t of setA) if (!setB.has(t)) return true;
  for (const t of setB) if (!setA.has(t)) return true;
  return false;
}

function polarityDiverges(flagsA, flagsB) {
  const keys = new Set([...Object.keys(flagsA), ...Object.keys(flagsB)]);
  for (const k of keys) if (Boolean(flagsA[k]) !== Boolean(flagsB[k])) return true;
  return false;
}

// Numero de unidades num pack, extraido do nome - "Pack 6", "Pack de 6",
// "6UN"/"6 UN"/"6 unidades", ou "6x250ml" (reaproveita o multiplicador que
// QTY_RE ja captura). Null quando nao ha nenhum sinal de pack - tratado
// como 1 unidade (compra avulsa) pelo chamador, nunca aqui.
const PACK_COUNT_RE = /\bpack\s*(?:de\s*)?(\d+)\b|\b(\d+)\s*un(?:idades?)?\b/i;

function extractPackCount(name) {
  const multi = name.match(QTY_RE);
  if (multi && multi[1]) return Number(multi[1]);
  const m = name.match(PACK_COUNT_RE);
  if (m) return Number(m[1] || m[2]);
  return null;
}

// Bebidas nao-alcoolicas onde o consumidor tipicamente compra a unidade (1
// lata, 1L, 2L) - ao contrario de cerveja/vinho (caixas/packs sao compra
// normal) ou laticinios como iogurtes (packs de 4/6 sao a forma habitual).
// Motivado por um caso real reportado pelo utilizador: "Ice Tea Pessego
// Pack 6" (Lipton) emparelhado com "Ice Tea Pessego" sem pack - Continente
// 1,79e vs Pingo Doce 5,34e, estavel ha 2 semanas (nao e staleness, e
// embalagens diferentes). QTY_RE/PACK_WORDS ja removem "pack"/numeros dos
// tokens do nome antes do jaccard - a diferenca de pack fica invisivel ao
// score de nome, por isso precisa de um gate a parte, como o de sabor/
// variante. cafe_cha ficou de fora deliberadamente - capsulas de cafe
// compram-se tipicamente em caixa (pack e a norma, nao a excecao), mesmo
// padrao dos iogurtes.
const PACK_SENSITIVE_SUBCATEGORIES = new Set(["refrigerantes_sumos", "agua"]);

function packCountDiverges(a, b) {
  const subcat = a.subcategory || b.subcategory;
  if (!PACK_SENSITIVE_SUBCATEGORIES.has(subcat)) return false;
  const countA = extractPackCount(a.name) ?? 1;
  const countB = extractPackCount(b.name) ?? 1;
  return countA !== countB;
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return inter / union;
}

function extractQuantityWithFallback(name, price, pricePerUnit) {
  const fromName = extractQuantity(name);
  if (fromName) return fromName;
  if (pricePerUnit && price) return { qty: Number((price / pricePerUnit).toFixed(4)), kind: "proxy", multiplier: 1 };
  return null;
}

function prep(list, ownBrandRe) {
  return list.map((p) => {
    const brand = (p.brand || "").trim();
    const ownBrand = ownBrandRe.test(brand);
    const qty = extractQuantityWithFallback(p.name, p.price, p.pricePerUnit);
    const { tokens, normalizedText } = normalizeName(p.name, ownBrand ? "" : brand);
    const polarity = polarityFlags(normalizedText);
    return { ...p, ownBrand, qty, tokens, polarity, brandNorm: stripAccents(brand.toLowerCase()) };
  });
}

const QTY_TOLERANCE = 0.05;

// "proxy" (price/pricePerUnit) sai sempre na unidade que pricePerUnit usa -
// kg ou L - porque e assim que as lojas anunciam preco/unidade. Uma
// quantidade real extraida do nome do produto (extractQuantity) esta sempre
// em g/ml (toBaseUnit converte kg->g e L->ml). Comparar os dois em bruto da
// sempre ~99% de diferenca mesmo quando o produto e identico (ex. proxy=1
// kg-equivalente vs real=1000 g). Escala o proxy para g/ml antes de comparar.
function scaleProxyToBaseUnit(qty, otherKind) {
  if (qty.kind === "proxy" && (otherKind === "weight" || otherKind === "volume")) {
    return { ...qty, qty: qty.qty * 1000 };
  }
  return qty;
}

function qtyMatches(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind && a.kind !== "proxy" && b.kind !== "proxy") return false;
  const scaledA = scaleProxyToBaseUnit(a, b.kind);
  const scaledB = scaleProxyToBaseUnit(b, a.kind);
  return Math.abs(scaledA.qty - scaledB.qty) / Math.max(scaledA.qty, scaledB.qty) <= QTY_TOLERANCE;
}

const NAME_THRESHOLD = 0.45;

// Categorias onde a marca (propria ou de fabricante) nao e um bom sinal de
// "mesmo produto" - fruta/legumes sao maioritariamente vendidos a peso, sem
// marca ou com a marca da propria loja, e "Banana" da Continente e "Banana"
// do Pingo Doce sao efetivamente equivalentes para efeitos de comparacao de
// preco, mesmo sem bater a marca. Para estas, ignora-se o balde de marca por
// completo (compara-se contra toda a lista do outro lado) - nome+quantidade
// continuam a ser o criterio real (qtyMatches + jaccard + divergencia de
// sabor/variante), a marca so deixa de ser um pre-filtro obrigatorio.
// Nao alterar para outras categorias (talho/peixaria, padaria, congelados):
// a diferenca de origem/qualidade entre lojas e real e a comparacao seria
// enganadora sem o sinal de marca.
const IGNORE_BRAND_BUCKET_CATEGORIES = new Set(["frutas_legumes"]);
const PPU_TOLERANCE_CATEGORIES = IGNORE_BRAND_BUCKET_CATEGORIES;
const PPU_TOLERANCE = 0.15;

// Verificado com dados reais (107 matches novos de frutas_legumes): 0/107
// tinham peso confirmado dos dois lados, e o score de nome deixou passar
// pares com preco/unidade a divergir >100% (produtos claramente diferentes,
// ex. "Pessego Vermelho" vs "Pessego Vermelho BIO 500G"). Quando o
// preco/unidade esta disponivel dos dois lados, e um sinal mais fiavel que o
// score de nome para esta categoria - rejeita o par aqui, antes de gastar
// tempo a calcular jaccard. Quando falta de um dos lados, nao rejeita (nao
// ha como confirmar nem desmentir) - fica para revisao manual a jusante.
function ppuDivergesTooMuch(a, b) {
  const ppuA = a?.pricePerUnit;
  const ppuB = b?.pricePerUnit;
  if (ppuA == null || ppuB == null || ppuA <= 0 || ppuB <= 0) return false;
  return Math.max(ppuA, ppuB) / Math.min(ppuA, ppuB) - 1 > PPU_TOLERANCE;
}

// Usado por insertMatchesAll.mjs para decidir se um match de
// frutas_legumes/ownBrand que sobreviveu ao gate acima (ou seja, ou tem
// preco/unidade proximo, ou falta de um dos lados) vai para matched_products
// direto ou para revisao manual.
export function isSafeFrutasLegumesOwnBrand(m) {
  const ppuA = m.a.pricePerUnit;
  const ppuB = m.b.pricePerUnit;
  if (ppuA == null || ppuB == null || ppuA <= 0 || ppuB <= 0) return false;
  return Math.max(ppuA, ppuB) / Math.min(ppuA, ppuB) - 1 <= PPU_TOLERANCE;
}

// Compara duas listas de produtos (fonte A x fonte B) e devolve os pares que
// parecem ser o mesmo produto. ownBrandReA/B identifica marca propria de cada
// insignia (emparelha so por nome+quantidade, nunca por igualdade de marca).
export function matchTwoSources(listA, ownBrandReA, listB, ownBrandReB) {
  const a = prep(listA, ownBrandReA);
  const b = prep(listB, ownBrandReB);

  const buckets = new Map();
  const byCategory = new Map();
  for (const p of b) {
    const key = p.ownBrand ? "OWN" : p.brandNorm;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }

  // Para frutas_legumes, o candidato certo pode estar em 2 sitios diferentes
  // consoante o caso real encontrado (e podem ser assimetricos - qualquer
  // combinacao de marca real/marca-propria/sem-marca de cada lado):
  //  - mesma marca real dos dois lados, categoria diferente entre lojas (ex.
  //    "Sementes de Sesamo Cem Porcento" - Continente poe em frutas_legumes,
  //    Pingo Doce em mercearia_doce_salgada) -> so o balde normal por texto
  //    de marca (buckets.get(brandNorm)) encontra isto, porque da
  //    cross-categoria de graca (o balde e por marca, nao por categoria).
  //  - qualquer combinacao envolvendo marca-propria/sem-marca de um ou dos
  //    dois lados, mesma categoria (ex. "Banana" sem marca x "Banana"
  //    marca-propria; "Physalis Nativa" marca real x "Physalis" marca
  //    generica do Pingo Doce; "Beterraba Cozida Continente" marca-propria x
  //    "Beterraba Cozida" da Huercasa, marca real) -> so aparece com todos
  //    os produtos da mesma categoria do outro lado, independente da marca
  //    de cada um (o jaccard de nome e que decide se sao mesmo o mesmo
  //    produto, a marca deixa de pre-filtrar).
  // Junta os dois - o resultado e a uniao, nunca so um dos dois.
  function relaxedCandidates(p) {
    const set = new Set();
    if (!p.ownBrand && p.brandNorm) {
      for (const item of buckets.get(p.brandNorm) || []) set.add(item);
    }
    for (const item of byCategory.get(p.category) || []) set.add(item);
    return set.size ? [...set] : null;
  }

  const matches = [];
  for (const p of a) {
    const key = p.ownBrand ? "OWN" : p.brandNorm;
    const useRelaxed = IGNORE_BRAND_BUCKET_CATEGORIES.has(p.category);
    const candidates = useRelaxed ? relaxedCandidates(p) : buckets.get(key);
    if (!candidates) continue;
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      if (!qtyMatches(p.qty, c.qty)) continue;
      // O gate de preco/unidade so se aplica quando pelo menos um dos lados
      // nao tem marca real a confirmar o par (marca-propria ou sem-marca) -
      // um par onde os dois lados batem na mesma marca real (ex. "Cem
      // Porcento" nos dois, "Vitacress" nos dois) ja tem esse sinal forte e
      // nao precisa do preco/unidade como criterio extra.
      const sameRealBrand = key !== "OWN" && key !== "" && key === (c.ownBrand ? "OWN" : c.brandNorm);
      const gateApplies = (useRelaxed || PPU_TOLERANCE_CATEGORIES.has(c.category)) && !sameRealBrand;
      if (gateApplies && ppuDivergesTooMuch(p, c)) continue;
      if (diverges(p.tokens, c.tokens, FLAVOR_WORDS)) continue;
      if (diverges(p.tokens, c.tokens, VARIANT_WORDS)) continue;
      if (polarityDiverges(p.polarity, c.polarity)) continue;
      if (packCountDiverges(p, c)) continue;
      const score = jaccard(p.tokens, c.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= NAME_THRESHOLD) {
      matches.push({
        score: Number(bestScore.toFixed(3)),
        ownBrand: p.ownBrand,
        a: { name: p.name, brand: p.brand, price: p.price, pricePerUnit: p.pricePerUnit ?? null, qty: p.qty, url: p.url, imageUrl: p.imageUrl ?? null, category: p.category, subcategory: p.subcategory ?? null },
        b: { name: best.name, brand: best.brand, price: best.price, pricePerUnit: best.pricePerUnit ?? null, qty: best.qty, url: best.url, imageUrl: best.imageUrl ?? null, category: best.category, subcategory: best.subcategory ?? null },
      });
    }
  }
  matches.sort((x, y) => y.score - x.score);
  return matches;
}

export const OWN_BRAND_RE = {
  continente: /^(continente|da nossa pastelaria)/i,
  "pingo-doce": /^(pingo doce|nossa |nosso |os nossos|comida fresca)/i,
  lidl: /^(chef select|cien|milbona|alesto|freeway|solevita|ocean sea|kania|snack day|formil|silvercrest|parkside|crivit|tastino|deluxe|w5|vitasan|vemondo|sondey)/i,
  auchan: /^(auchan|pouce|cosmia)/i,
  aldi: /^(aldi|crofton|frantastique|up2fashion|workzone|cucina|ravini|deco craft|power force|milsani|choceur)/i,
};

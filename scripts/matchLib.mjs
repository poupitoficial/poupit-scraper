// Motor de matching de produtos entre duas fontes (extraido de matchProducts.mjs
// para poder ser reutilizado nos 3 pares Continente/Pingo Doce/Lidl sem duplicar
// a logica). Ver matchProducts.mjs (o par original Pingo Doce x Continente) para
// o historico/racional de cada heuristica.

const PACK_WORDS = new Set([
  "pack", "un", "uni", "unid", "unidade", "unidades", "embalagem", "emb",
  "garrafa", "lata", "saco", "cx", "caixa", "pacote", "pct", "tabuleiro",
  "bandeja", "frasco", "tina", "tinas", "bolsa", "bolsas", "goma",
]);

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const QTY_RE = /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b|(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/i;

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
  const m = name.match(QTY_RE);
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

function normalizeName(name, brand) {
  let s = stripAccents(name.toLowerCase());
  s = s.replace(QTY_RE, " ");
  if (brand) s = s.replace(stripAccents(brand.toLowerCase()), " ");
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(/\s+/).filter((t) => t && !PACK_WORDS.has(t) && !/^\d+$/.test(t));
  return { tokens, normalizedText: s };
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

const VARIANT_WORDS = new Set([
  "light", "zero", "integral", "magro", "magra", "gordo", "gorda",
  "desnatado", "desnatada", "meio", "meia",
  "bio", "organico", "organica", "biologico", "biologica", "diet",
  "reforcado", "reforcada", "extra", "premium",
  "tradicional", "classico", "classica", "original", "artesanal",
  "caseiro", "caseira", "cremoso", "cremosa",
]);

const POLARITY_NOUNS = ["gluten", "acucar", "lactose", "sal", "gordura", "cafeina", "conservantes", "corantes"];

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
function qtyMatches(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind && a.kind !== "proxy" && b.kind !== "proxy") return false;
  return Math.abs(a.qty - b.qty) / Math.max(a.qty, b.qty) <= QTY_TOLERANCE;
}

const NAME_THRESHOLD = 0.45;

// Compara duas listas de produtos (fonte A x fonte B) e devolve os pares que
// parecem ser o mesmo produto. ownBrandReA/B identifica marca propria de cada
// insignia (emparelha so por nome+quantidade, nunca por igualdade de marca).
export function matchTwoSources(listA, ownBrandReA, listB, ownBrandReB) {
  const a = prep(listA, ownBrandReA);
  const b = prep(listB, ownBrandReB);

  const buckets = new Map();
  for (const p of b) {
    const key = p.ownBrand ? "OWN" : p.brandNorm;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  const matches = [];
  for (const p of a) {
    const key = p.ownBrand ? "OWN" : p.brandNorm;
    const candidates = buckets.get(key);
    if (!candidates) continue;

    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      if (!qtyMatches(p.qty, c.qty)) continue;
      if (diverges(p.tokens, c.tokens, FLAVOR_WORDS)) continue;
      if (diverges(p.tokens, c.tokens, VARIANT_WORDS)) continue;
      if (polarityDiverges(p.polarity, c.polarity)) continue;
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
        a: { name: p.name, brand: p.brand, price: p.price, qty: p.qty, url: p.url, imageUrl: p.imageUrl ?? null, category: p.category, subcategory: p.subcategory ?? null },
        b: { name: best.name, brand: best.brand, price: best.price, qty: best.qty, url: best.url, imageUrl: best.imageUrl ?? null, category: best.category, subcategory: best.subcategory ?? null },
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

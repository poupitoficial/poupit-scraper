import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pd = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pd_products_full.json")));
const ct = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "continente_products_full.json")));

// Marcas proprias (private label) de cada insignia - qualquer produto com uma
// destas marcas e considerado "marca da casa" e emparelhado so por nome+quantidade,
// nao por igualdade de marca (a marca em si nunca vai coincidir entre as duas).
const PD_OWN_BRAND_RE = /^(pingo doce|nossa |nosso |os nossos|comida fresca)/i;
const CT_OWN_BRAND_RE = /^(continente|da nossa pastelaria)/i;

const PACK_WORDS = new Set([
  "pack", "un", "uni", "unid", "unidade", "unidades", "embalagem", "emb",
  "garrafa", "lata", "saco", "cx", "caixa", "pacote", "pct", "tabuleiro",
  "bandeja", "frasco", "tina", "tinas", "bolsa", "bolsas", "goma",
]);

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Extrai quantidade/unidade do nome (ex: "6x330ml", "1,5L", "500g", "1Kg") e
// normaliza para gramas (peso) ou mililitros (volume); "x" multiplica o total.
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
  if (brand) {
    s = s.replace(stripAccents(brand.toLowerCase()), " ");
  }
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(/\s+/).filter((t) => t && !PACK_WORDS.has(t) && !/^\d+$/.test(t));
  return { tokens, normalizedText: s };
}

// Palavras que mudam o produto mesmo com o resto do nome identico. Se aparecem
// so num dos dois lados, veta o match independentemente do score de Jaccard.
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

// Modificadores de dieta/variante: presenca/ausencia divergente tambem veta.
const VARIANT_WORDS = new Set([
  "light", "zero", "integral", "magro", "magra", "gordo", "gorda",
  "desnatado", "desnatada", "meio", "meia",
  "bio", "organico", "organica", "biologico", "biologica", "diet",
  "reforcado", "reforcada", "extra", "premium",
  "tradicional", "classico", "classica", "original", "artesanal",
  "caseiro", "caseira", "cremoso", "cremosa",
]);

// Pares "sem X" / "com X" que invertem o significado mesmo partilhando o token X
// (ex.: "sem gluten" vs "com gluten" partilham "gluten" mas sao produtos opostos).
const POLARITY_NOUNS = ["gluten", "acucar", "lactose", "sal", "gordura", "cafeina", "conservantes", "corantes"];

function polarityFlags(text) {
  const flags = {};
  for (const noun of POLARITY_NOUNS) {
    const semRe = new RegExp(`sem\\s+${noun}`);
    const comRe = new RegExp(`com\\s+${noun}`);
    if (semRe.test(text)) flags[`sem_${noun}`] = true;
    else if (comRe.test(text)) flags[`com_${noun}`] = true;
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

// Quando o nome nao traz tamanho explicito, usa price/pricePerUnit como proxy
// de quantidade (pricePerUnit e sempre por Kg, L ou Un consoante o produto -
// nao sabemos qual, mas o racio ainda serve para comparar duas fontes do
// mesmo tipo de produto).
function extractQuantityWithFallback(name, price, pricePerUnit) {
  const fromName = extractQuantity(name);
  if (fromName) return fromName;
  if (pricePerUnit && price) {
    return { qty: Number((price / pricePerUnit).toFixed(4)), kind: "proxy", multiplier: 1 };
  }
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

const pdPrepped = prep(pd, PD_OWN_BRAND_RE);
const ctPrepped = prep(ct, CT_OWN_BRAND_RE);

// Bucketiza o lado Continente por chave de marca (OWN para marca propria,
// senao a marca normalizada) para nao comparar N x M produtos (7493 x 6577).
const buckets = new Map();
for (const p of ctPrepped) {
  const key = p.ownBrand ? "OWN" : p.brandNorm;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(p);
}

const QTY_TOLERANCE = 0.05; // 5%
function qtyMatches(a, b) {
  if (!a && !b) return true; // nenhum dos dois tem quantidade (nem nome nem pricePerUnit)
  if (!a || !b) return false;
  if (a.kind !== b.kind && a.kind !== "proxy" && b.kind !== "proxy") return false;
  return Math.abs(a.qty - b.qty) / Math.max(a.qty, b.qty) <= QTY_TOLERANCE;
}

const NAME_THRESHOLD = 0.45;
const matches = [];

for (const p of pdPrepped) {
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
      pd: { name: p.name, brand: p.brand, price: p.price, qty: p.qty, url: p.url, imageUrl: p.imageUrl ?? null },
      continente: { name: best.name, brand: best.brand, price: best.price, qty: best.qty, url: best.url, imageUrl: best.imageUrl ?? null },
    });
  }
}

matches.sort((a, b) => b.score - a.score);

console.log(`Total matches encontrados: ${matches.length} (de ${pd.length} produtos PD x ${ct.length} produtos Continente)`);

// Amostra de 20: mistura de scores altos, medios e marca propria vs marca de fabricante,
// para dar uma visao representativa da precisao do algoritmo.
const ownMatches = matches.filter((m) => m.ownBrand);
const brandMatches = matches.filter((m) => !m.ownBrand);

function sample(arr, n) {
  const step = Math.max(1, Math.floor(arr.length / n));
  const out = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
}

const sampleSet = [...sample(brandMatches, 12), ...sample(ownMatches, 8)];

const outDir = path.join(__dirname, "..", "analysis");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "matches_all.json"), JSON.stringify(matches, null, 2));
fs.writeFileSync(path.join(outDir, "matches_sample20.json"), JSON.stringify(sampleSet, null, 2));

console.log(`\nMarca de fabricante: ${brandMatches.length} matches | Marca propria: ${ownMatches.length} matches`);
console.log("\n=== AMOSTRA DE 20 PARES ===\n");
for (const m of sampleSet) {
  console.log(`[score ${m.score}] ${m.ownBrand ? "(marca propria)" : "(marca fabricante: " + m.pd.brand + ")"}`);
  console.log(`  PD:  ${m.pd.name} | ${m.pd.brand} | ${m.pd.price}€ | qty=${JSON.stringify(m.pd.qty)}`);
  console.log(`  CT:  ${m.continente.name} | ${m.continente.brand} | ${m.continente.price}€ | qty=${JSON.stringify(m.continente.qty)}`);
  console.log("");
}

import he from "he";
import { classifyPdUrl } from "./pingoDoceCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;
// Produtos de balcao (padaria/talho/peixaria) vendidos a peso na loja fisica
// aparecem no catalogo online do Pingo Doce com 0.01e como valor de
// preenchimento (nao vendaveis online) - confirmado ao vivo (auditoria de
// precos desta sessao: 9 produtos, "Pao Brasileiro", "Picanha de Bovino",
// "Camarao Cozido"...). Nao e um bug de parsing nosso, e um placeholder do
// proprio site - filtra-se aqui como preco invalido, tal como MAX_PRODUCT_PRICE.
export const MIN_PRODUCT_PRICE = 0.05;

const SITEMAP_INDEX_URL = "https://www.pingodoce.pt/home/sitemap_index.xml";
const LOC_RE = /<loc>([^<]+)<\/loc>/g;

const GTM_INFO_RE = /data-gtm-info="([^"]+)"/g;
const PRICE_VALUE_RE = /class="value" content="([\d.]+)"/;
const UNIT_MEASURE_RE = /class="product-unit-measure">([^<]*)</;
const PRICE_PER_UNIT_RE = /(\d+,\d+)\s*€\s*\/\s*\w+/;
const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Afinavel por env var (ex. PINGODOCE_DELAY_MS=1000). Ja sequencial (sem
// concurrency), por isso so o delay precisa de expor um travao adicional.
function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)",
      Accept: "text/html,application/xml",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function extractLocs(xml) {
  const locs = [];
  let m;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml))) locs.push(m[1]);
  return locs;
}

// O sitemap do Pingo Doce ja traz a categoria completa no proprio URL do produto,
// por isso conseguimos filtrar so pelas paginas que interessam sem abrir nenhuma.
export async function collectRelevantProductUrls() {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const sitemapUrls = extractLocs(indexXml).filter((u) => u.includes("-product.xml"));

  const relevant = [];
  for (const sitemapUrl of sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    for (const productUrl of extractLocs(xml)) {
      const classification = classifyPdUrl(productUrl);
      if (classification) relevant.push({ url: productUrl, ...classification });
    }
  }
  return relevant;
}

function parsePricePerUnit(unitMeasureText) {
  if (!unitMeasureText) return null;
  const match = he.decode(unitMeasureText).match(PRICE_PER_UNIT_RE);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function parseImageUrl(html) {
  const ldMatch = html.match(LD_JSON_RE);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      if (Array.isArray(data.image) && data.image[0]) return data.image[0];
      if (typeof data.image === "string") return data.image;
    } catch {
      // ignora, tenta fallback abaixo
    }
  }
  const imgMatch = html.match(/<img[^>]+itemprop="image"[^>]+src="([^"]+)"/);
  return imgMatch ? he.decode(imgMatch[1]) : null;
}

// A pagina traz varios atributos data-gtm-info (um deles vazio, de layout
// generico); so o do bloco "product-detail" tem o item real com preco e marca.
function findProductGtmItem(html) {
  GTM_INFO_RE.lastIndex = 0;
  let m;
  while ((m = GTM_INFO_RE.exec(html))) {
    let gtm;
    try {
      gtm = JSON.parse(he.decode(m[1]));
    } catch {
      continue;
    }
    const item = gtm.items?.[0];
    if (item?.item_id) return item;
  }
  return null;
}

function parseProductPage(html, url, category, subcategory) {
  const item = findProductGtmItem(html);
  if (!item) return null;

  const priceMatch = html.match(PRICE_VALUE_RE);
  const price = priceMatch ? Number(priceMatch[1]) : item.price;

  const unitMatch = html.match(UNIT_MEASURE_RE);

  return {
    id: String(item.item_id),
    name: item.item_name,
    brand: item.item_brand || null,
    price,
    pricePerUnit: parsePricePerUnit(unitMatch?.[1]),
    url,
    imageUrl: parseImageUrl(html),
    category,
    subcategory,
  };
}

// Percorre so as paginas de produto individuais relevantes (nao usa nenhum
// endpoint ajax/Search-*, que o robots.txt do Pingo Doce bloqueia).
export async function* fetchPingoDoceProducts({ onProductError, delayMs = envInt("PINGODOCE_DELAY_MS", 750), urls: urlsOverride } = {}) {
  const productUrls = urlsOverride ?? (await collectRelevantProductUrls());

  for (const { url, category, subcategory } of productUrls) {
    try {
      const html = await fetchText(url);
      const product = parseProductPage(html, url, category, subcategory);
      if (product && product.price) yield product;
    } catch (err) {
      onProductError?.(url, err);
    }
    await sleep(delayMs);
  }
}

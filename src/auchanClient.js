import he from "he";
import { CATEGORY_URLS } from "./auchanCategoryUrls.js";
import { classifyAuchanBreadcrumb } from "./auchanCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

// Paginas de categoria "folha" (usadas ate agora) so mostram ate ~24 produtos;
// o resto fica atras de um botao "mostrar mais" que chama um endpoint ajax
// bloqueado por robots.txt (prefn1/prefv1). 380 das 752 categorias (50%) tem
// mais de 24 produtos - o scraper anterior nunca via esses. O robots.txt do
// Auchan expoe um sitemap de produto (Sitemap: /sitemap_index.xml), sem
// paginacao nenhuma bloqueada - por isso passamos a descobrir produtos por ai
// e a ler cada pagina de produto individual (mesmo padrao do Pingo Doce).
const SITEMAP_INDEX_URL = "https://www.auchan.pt/sitemap_index.xml";
const LOC_RE = /<loc>([^<]+)<\/loc>/g;
const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const PRICE_PER_UNIT_RE = /class="auc-measures--price-per-unit">([^<]*)</;
const PRICE_PER_UNIT_NUM_RE = /(\d+[.,]\d+)\s*€/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Afinavel por env var sem reescrever codigo (ex. AUCHAN_DELAY_MS=2000) - o
// Auchan usava os mesmos defaults (concurrency=10/delayMs=150, ~3 req/s) que
// bloquearam o Continente, com catalogo ainda maior (30000+ URLs).
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

// So os produtos cujo URL comeca por uma das 752 categorias-folha ja
// mapeadas (as mesmas usadas na abordagem anterior) - mantem o mesmo scope
// de "categorias alimentares/relevantes" sem ter de reclassificar do zero
// que paginas interessam.
function isRelevantProductUrl(url) {
  return CATEGORY_URLS.some((prefix) => url.startsWith(prefix));
}

export async function collectRelevantProductUrls() {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const sitemapUrls = extractLocs(indexXml).filter((u) => u.includes("-product.xml"));

  const urls = new Set();
  for (const sitemapUrl of sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    for (const productUrl of extractLocs(xml)) {
      if (isRelevantProductUrl(productUrl)) urls.add(productUrl);
    }
  }
  return [...urls];
}

function parsePricePerUnit(html) {
  const match = html.match(PRICE_PER_UNIT_RE);
  if (!match) return null;
  const value = he.decode(match[1]).match(PRICE_PER_UNIT_NUM_RE);
  return value ? Number(value[1].replace(",", ".")) : null;
}

// A pagina de produto traz 3 blocos <script type="application/ld+json">:
// Organization, BreadcrumbList (nome da categoria em 2-4 niveis) e Product
// (nome, marca, sku, gtin, imagens, preco, disponibilidade). Ao contrario do
// tile da pagina de categoria (data-gtm-new, sempre 4 niveis), o breadcrumb
// aqui pode ter menos niveis - classifyAuchanBreadcrumb ja tolera isso
// (ignora argumentos undefined).
function parseLdJsonBlocks(html) {
  const blocks = [];
  let m;
  LD_JSON_RE.lastIndex = 0;
  while ((m = LD_JSON_RE.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // ignora blocos invalidos
    }
  }
  return blocks;
}

function parseProductPage(html, url) {
  const blocks = parseLdJsonBlocks(html);
  const product = blocks.find((b) => b["@type"] === "Product");
  if (!product?.sku || !product?.offers) return null;

  const breadcrumbList = blocks.find((b) => b["@type"] === "BreadcrumbList");
  const crumbs = (breadcrumbList?.itemListElement || [])
    .sort((a, b) => a.position - b.position)
    .map((c) => c.item?.name)
    .filter(Boolean);

  const classification = classifyAuchanBreadcrumb(crumbs[0], crumbs[1], crumbs[2], crumbs[3]);
  if (!classification) return null;

  if (product.offers.availability && !/InStock/i.test(product.offers.availability)) return null;

  const price = Number(product.offers.price);
  if (!Number.isFinite(price)) return null;

  const image = Array.isArray(product.image) ? product.image[0] : product.image;

  const barcode = product.gtin13 || product.gtin || product.gtin12 || product.gtin8 || product.gtin14 || null;

  return {
    id: String(product.sku),
    name: product.name,
    brand: product.brand?.name || null,
    price,
    pricePerUnit: parsePricePerUnit(html),
    url,
    imageUrl: image || null,
    category: classification.category,
    subcategory: classification.subcategory,
    barcode,
  };
}

// Descobre produtos pelo sitemap (nao pela pagina de categoria) e le cada
// pagina de produto individual em paralelo controlado - o salto de ~752
// pedidos (uma por categoria) para dezenas de milhares (uma por produto) exige
// concorrencia, senao a corrida demora horas.
export async function* fetchAuchanProducts({
  onProductError,
  onProgress,
  concurrency = envInt("AUCHAN_CONCURRENCY", 2),
  delayMs = envInt("AUCHAN_DELAY_MS", 1000),
  urls: urlsOverride,
} = {}) {
  const urls = urlsOverride ?? (await collectRelevantProductUrls());
  onProgress?.({ phase: "urls-collected", total: urls.length });

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const html = await fetchText(url);
          return parseProductPage(html, url);
        } catch (err) {
          onProductError?.(url, err);
          return null;
        }
      })
    );
    for (const p of results) if (p) yield p;
    onProgress?.({ phase: "batch-done", processed: Math.min(i + concurrency, urls.length), total: urls.length });
    await sleep(delayMs);
  }
}

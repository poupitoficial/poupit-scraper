import { classifyAldiProduct } from "./aldiCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

// Sitemap de produtos oficial (declarado no robots.txt: Sitemap:
// https://www.aldi.pt/.aldi-nord-sitemap.xml, que aponta para este). So 303
// URLs no total - catalogo pequeno tipico de discount, sem paginacao a
// gerir.
const SITEMAP_INDEX_URL = "https://www.aldi.pt/.aldi-nord-sitemap.xml";
const LOC_RE = /<loc>([^<]+)<\/loc>/g;
const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Afinavel por env var (ex. ALDI_DELAY_MS=1000). So 303 URLs no total -
// volume baixo nao acumula deteccao mesmo a ritmo mais alto que Continente/
// Auchan, por isso fica com um valor intermedio em vez do mesmo travao.
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

export async function collectProductUrls() {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const sitemapUrls = extractLocs(indexXml).filter((u) => u.includes("-sitemap-products.xml"));
  const urls = new Set();
  for (const sitemapUrl of sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    for (const productUrl of extractLocs(xml)) urls.add(productUrl);
  }
  return [...urls];
}

// A pagina de produto nao tem application/ld+json (ao contrario de
// Continente/Pingo Doce/Auchan) - os dados vem embutidos em
// <script id="__NEXT_DATA__"> (Next.js/Magnolia SSR), num bloco
// PRODUCT_DETAIL_GET dentro de props.pageProps.apiData (string JSON dupla).
// Produtos indisponiveis/descontinuados devolvem antes uma pagina de
// "lembrete" sem esse bloco - parseProductPage devolve null nesse caso.
function parseProductPage(html, url) {
  const m = html.match(NEXT_DATA_RE);
  if (!m) return null;

  let nextData;
  try {
    nextData = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const apiRaw = nextData?.props?.pageProps?.apiData;
  if (!apiRaw) return null;

  let api;
  try {
    api = JSON.parse(apiRaw);
  } catch {
    return null;
  }

  const entry = Array.isArray(api) ? api.find((e) => e[0] === "PRODUCT_DETAIL_GET") : null;
  const product = entry?.[1]?.res?.products?.[0];
  if (!product?.objectID || !product.name) return null;
  if (product.isAvailable === false) return null;

  const price = product.currentPrice?.priceValue;
  if (!Number.isFinite(price)) return null;

  const basePrice = product.currentPrice?.basePrice?.[0]?.basePriceValue;
  const classification = classifyAldiProduct(product.name);
  if (!classification) return null;

  const image = product.assets?.find((a) => a.type === "primary")?.url || product.assets?.[0]?.url || null;

  return {
    id: String(product.objectID),
    name: product.name.trim(),
    brand: product.brandName || null,
    price,
    pricePerUnit: Number.isFinite(basePrice) ? basePrice : null,
    url,
    imageUrl: image,
    category: classification.category,
    subcategory: classification.subcategory,
  };
}

// So 303 URLs no total - concorrencia baixa e suficiente, sem necessidade da
// logica de retoma/lotes usada no Auchan (30000+ URLs).
export async function* fetchAldiProducts({
  onProductError,
  onProgress,
  concurrency = envInt("ALDI_CONCURRENCY", 4),
  delayMs = envInt("ALDI_DELAY_MS", 300),
} = {}) {
  const urls = await collectProductUrls();
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

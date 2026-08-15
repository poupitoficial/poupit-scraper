import { classifyLidlBreadcrumb } from "./lidlCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

const SITEMAP_URL = "https://www.lidl.pt/p/export/PT/pt/product_sitemap.xml.gz";
const DETAIL_API = (id) => `https://www.lidl.pt/p/api/detail/${id}/PT/pt`;
const ID_RE = /\/p\/[^/]+\/p(\d+)</g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

// O catalogo do Lidl e pequeno (dezenas/centenas de produtos), listado no proprio
// sitemap oficial deles. Nao esta no disallow do robots.txt.
export async function collectProductIds() {
  const res = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${SITEMAP_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zlib = await import("node:zlib");
  const xml = zlib.gunzipSync(buf).toString("utf-8");
  return [...xml.matchAll(ID_RE)].map((m) => m[1]);
}

function parsePricePerUnit(basePriceText) {
  if (!basePriceText) return null;
  // ex: "1 L = 0.99" ou "1 kg = 3,49"
  const match = basePriceText.match(/([\d]+[.,]\d+)\s*$/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function parseDetail(detail) {
  if (!detail.havingPrice || typeof detail.price?.price !== "number") return null;

  const classification = classifyLidlBreadcrumb(detail.keyfacts?.wonCategoryPrimary);
  if (!classification) return null;

  const firstImageId = detail.media?.gallery?.images?.[0];
  const imageUrl = firstImageId ? detail.media?.imageMap?.[firstImageId]?.largeUrl ?? null : null;

  return {
    id: String(detail.itemId),
    name: detail.keyfacts?.fullTitle ?? detail.keyfacts?.title,
    brand: detail.info?.brand?.showBrand ? detail.info.brand.name : null,
    ean: detail.eans?.[0] ?? null,
    price: detail.price.price,
    pricePerUnit: parsePricePerUnit(detail.price.basePrice?.text),
    url: detail.canonicalUrl ? `https://www.lidl.pt${detail.canonicalUrl}` : null,
    imageUrl,
    category: classification.category,
    subcategory: classification.subcategory,
  };
}

// So usa a API JSON escondida (/p/api/detail/...), nunca faz scraping de HTML.
// Nao esta bloqueada pelo robots.txt do Lidl (que so bloqueia paths comecados
// por digito, /q/search e alguns assets tecnicos).
export async function* fetchLidlProducts({ onProductError, delayMs = 200 } = {}) {
  const ids = await collectProductIds();

  for (const id of ids) {
    try {
      const detail = await fetchJson(DETAIL_API(id));
      const product = parseDetail(detail);
      if (product) yield product;
    } catch (err) {
      onProductError?.(id, err);
    }
    await sleep(delayMs);
  }
}

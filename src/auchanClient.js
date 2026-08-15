import he from "he";
import { CATEGORY_URLS } from "./auchanCategoryUrls.js";
import { classifyAuchanBreadcrumb } from "./auchanCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

const PRODUCT_BLOCK_SPLIT_RE = /(?=<div class="product" data-pid="\d+">)/;
const GTM_NEW_RE = /data-gtm-new="([^"]+)"/;
const PRODUCT_URL_RE = /class="pdp-link">[\s\S]{0,60}<h3><a class="link" href="([^"]+)"/;
const IMAGE_URL_RE = /<img\s+src="[^"]*"\s+data-src="([^"]+)"/;
const PRICE_VALUE_RE = /class="value" content="([\d.]+)"/;
const PRICE_PER_UNIT_RE = /class="auc-measures--price-per-unit">([^<]*)</;
const PRICE_PER_UNIT_NUM_RE = /(\d+[.,]\d+)\s*€/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pagina de categoria normal (HTML tal como um browser/crawler a veria), nao o
// endpoint ajax Search-UpdateGrid. O robots.txt do Auchan bloqueia os parametros
// que esse endpoint exige por omissao (prefn1/prefv1/srule), tal como acontece
// no Continente - por isso usamos a mesma abordagem de paginas de categoria
// "folha" (sem paginacao, ate ~24 produtos por pagina).
async function fetchCategoryPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function parsePricePerUnit(block) {
  const match = block.match(PRICE_PER_UNIT_RE);
  if (!match) return null;
  const value = he.decode(match[1]).match(PRICE_PER_UNIT_NUM_RE);
  return value ? Number(value[1].replace(",", ".")) : null;
}

// Cada tile traz um atributo data-gtm-new com um JSON (item_id, item_name,
// item_brand, item_category..4, price) usado pelo Auchan para analytics - inclui
// o breadcrumb completo de 4 niveis, por isso nao precisamos de abrir a pagina do
// produto para saber a categoria.
function parseTiles(html) {
  const blocks = html.split(PRODUCT_BLOCK_SPLIT_RE);
  const tiles = [];

  for (const block of blocks) {
    const gtmMatch = block.match(GTM_NEW_RE);
    if (!gtmMatch) continue;

    let gtm;
    try {
      gtm = JSON.parse(he.decode(gtmMatch[1]));
    } catch {
      continue;
    }
    if (!gtm.item_id) continue;

    const classification = classifyAuchanBreadcrumb(
      gtm.item_category,
      gtm.item_category2,
      gtm.item_category3,
      gtm.item_category4
    );
    if (!classification) continue;

    const priceMatch = block.match(PRICE_VALUE_RE);
    const price = priceMatch ? Number(priceMatch[1]) : Number(gtm.price);
    if (!Number.isFinite(price)) continue; // produto sem preco publicado (ex. so em loja)

    const urlMatch = block.match(PRODUCT_URL_RE);
    const imageMatch = block.match(IMAGE_URL_RE);

    tiles.push({
      id: String(gtm.item_id),
      name: gtm.item_name,
      brand: gtm.item_brand || null,
      price,
      pricePerUnit: parsePricePerUnit(block),
      url: urlMatch ? `https://www.auchan.pt${he.decode(urlMatch[1])}` : null,
      imageUrl: imageMatch ? he.decode(imageMatch[1]) : null,
      category: classification.category,
      subcategory: classification.subcategory,
    });
  }

  return tiles;
}

// Percorre todas as paginas de categoria "folha" mapeadas e devolve cada produto
// encontrado, ja classificado nas nossas 11 categorias a partir do breadcrumb
// real do proprio tile (nunca por palavra-chave no nome do produto).
export async function* fetchAuchanProducts({ onCategoryError } = {}) {
  for (const url of CATEGORY_URLS) {
    let html;
    try {
      html = await fetchCategoryPage(url);
    } catch (err) {
      onCategoryError?.(url, err);
      continue;
    }

    const tiles = parseTiles(html);
    for (const tile of tiles) yield { ...tile, sourceUrl: url };

    await sleep(300);
  }
}

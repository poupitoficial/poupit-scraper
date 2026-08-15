import he from "he";
import { CATEGORY_QUERIES } from "./categoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

const PRODUCT_BLOCK_SPLIT_RE = /(?=<div class="product" data-pid="\d+">)/;
const TILE_IMPRESSION_RE = /data-product-tile-impression='([^']+)'/;
const PRODUCT_URL_RE = /class="image-link[^"]*"\s+href="([^"]+)"/;
const IMAGE_URL_RE = /<img\s+class="ct-tile-image[\s\S]{0,400}?data-src="([^"]+)"/;
const PRICE_SECONDARY_RE = /class="pwc-tile--price-secondary">([\s\S]*?)<\/div>/;
const PRICE_PER_UNIT_RE = /(\d+,\d+)\s*€/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pagina de categoria normal (HTML servido tal como um browser/crawler a veria),
// nao o endpoint ajax Search-UpdateGrid. Sem paginacao: devolve so os produtos
// que o Continente decide mostrar primeiro (ate ~36).
async function fetchCategoryPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} em ${url}`);
  }
  return res.text();
}

function parsePricePerUnit(block) {
  const secondary = block.match(PRICE_SECONDARY_RE);
  if (!secondary) return null;
  const text = he.decode(secondary[1]).replace(/<[^>]+>/g, " ");
  const value = text.match(PRICE_PER_UNIT_RE);
  return value ? Number(value[1].replace(",", ".")) : null;
}

// Cada tile de produto traz um atributo data-product-tile-impression com um JSON
// (id, name, price, brand, category, ...) usado pelo Continente para analytics.
// E mais barato e fiavel do que parsear o HTML/CSS dos precos visiveis para esses
// campos. O url do produto, a imagem e o preco/unidade nao vem nesse JSON, por isso
// tem de se ir buscar ao resto do bloco HTML do tile (ainda assim so a esse bloco,
// nao a pagina toda do produto).
function parseTiles(html) {
  const blocks = html.split(PRODUCT_BLOCK_SPLIT_RE);
  const tiles = [];

  for (const block of blocks) {
    const impressionMatch = block.match(TILE_IMPRESSION_RE);
    if (!impressionMatch) continue;

    let data;
    try {
      data = JSON.parse(he.decode(impressionMatch[1]));
    } catch {
      continue; // tile sem JSON valido, ignora
    }

    const urlMatch = block.match(PRODUCT_URL_RE);
    const imageMatch = block.match(IMAGE_URL_RE);

    tiles.push({
      ...data,
      url: urlMatch ? he.decode(urlMatch[1]) : null,
      imageUrl: imageMatch ? he.decode(imageMatch[1]) : null,
      pricePerUnit: parsePricePerUnit(block),
    });
  }

  return tiles;
}

// Percorre todas as paginas de categoria "folha" mapeadas e devolve cada produto
// encontrado, ja anotado com a nossa categoria interna (mercearia, laticinios_ovos, ...).
// Um pedido HTTP normal por categoria, sem paginacao e sem parametros de query.
export async function* fetchCategoryProducts({ onCategoryError } = {}) {
  for (const { url, category, subcategory } of CATEGORY_QUERIES) {
    let html;
    try {
      html = await fetchCategoryPage(url);
    } catch (err) {
      onCategoryError?.(url, err);
      continue;
    }

    const tiles = parseTiles(html);
    for (const tile of tiles) {
      yield { ...tile, category, subcategory, sourceUrl: url };
    }

    await sleep(300);
  }
}

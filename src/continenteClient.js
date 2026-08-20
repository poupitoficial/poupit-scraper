import he from "he";
import { CATEGORY_QUERIES } from "./categoryMap.js";
import { classifyContinenteBreadcrumb } from "./continenteCategoryMap.js";

export const MAX_PRODUCT_PRICE = 100;

const PRODUCT_BLOCK_SPLIT_RE = /(?=<div class="product" data-pid="\d+">)/;
const TILE_IMPRESSION_RE = /data-product-tile-impression='([^']+)'/;
const PRODUCT_URL_RE = /class="image-link[^"]*"\s+href="([^"]+)"/;
const IMAGE_URL_RE = /<img\s+class="ct-tile-image[\s\S]{0,400}?data-src="([^"]+)"/;
const PRICE_SECONDARY_RE = /class="pwc-tile--price-secondary">([\s\S]*?)<\/div>/;
const PRICE_PER_UNIT_RE = /(\d+,\d+)\s*€/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Permite afinar o ritmo por loja via variavel de ambiente sem reescrever
// codigo (ex. CONTINENTE_DELAY_MS=2000), depois do bloqueio 474 do Continente
// causado por concurrency=10/delayMs=150 (~3 req/s) na via sitemap+PDP.
function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

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

// --- Via sitemap+PDP (complementar a fetchCategoryProducts acima) ---
//
// 60% das 369 paginas de categoria estao truncadas a ~35 produtos (botao
// "Ver mais produtos" chama Search-UpdateGrid com start=/sz=, bloqueados
// pelo robots.txt - ver investigacao desta sessao). O site tem sitemap de
// produtos (Sitemap: https://www.continente.pt/sitemap_index.xml), mas ao
// contrario do Auchan o URL do produto nao segue o caminho da categoria
// (e so /produto/{slug}-{id}.html) - nao ha forma de filtrar por prefixo
// antes de abrir cada pagina.
//
// Decisao tomada (autorizada): usar so sitemap-custom_sitemap_1-product.xml
// (~20000 URLs, confirmado por amostragem de 100+ pontos como ~97%
// mercearia/casa relevante). Os outros 5 ficheiros de produto (~81000 URLs)
// sao maioritariamente nao-alimentar (livros, maquilhagem, decoracao) com
// bebidas/alcool dispersas la dentro (confirmado: vinhos/licores caem sobretudo
// nos sitemaps 8, 12 e 4) - ficam de fora desta ronda, nao cobertos por esta
// funcao. bebidas continua a depender so de fetchCategoryProducts.
const SITEMAP_INDEX_URL = "https://www.continente.pt/sitemap_index.xml";
const PRODUCT_SITEMAP_URL = "https://www.continente.pt/sitemap-custom_sitemap_1-product.xml";
const LOC_RE = /<loc>([^<]+)<\/loc>/g;
const LD_JSON_PRODUCT_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
const BREADCRUMB_SECTION_MARKER = "product_breadcrumbs";
const BREADCRUMB_NAME_RE = /itemprop="name"[^>]*>([^<]*)</g;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)", Accept: "text/html,application/xml" },
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

// Confirma que o sitemap indicado no robots.txt ainda aponta para o
// sitemap_1-product.xml esperado, em vez de assumir o URL fixo para sempre
// (os nomes destes ficheiros ja mudaram de padrao no passado - custom_sitemap
// substituiu um esquema anterior).
export async function collectSitemapProductUrls() {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const productSitemaps = extractLocs(indexXml).filter((u) => u.includes("-product.xml"));
  if (!productSitemaps.includes(PRODUCT_SITEMAP_URL)) {
    throw new Error(
      `sitemap_1-product.xml nao encontrado no indice atual (${productSitemaps.length} sitemaps de produto listados) - a estrutura pode ter mudado, confirmar manualmente antes de continuar.`
    );
  }
  const xml = await fetchText(PRODUCT_SITEMAP_URL);
  return extractLocs(xml);
}

export function parseBreadcrumb(html) {
  const idx = html.indexOf(BREADCRUMB_SECTION_MARKER);
  if (idx === -1) return [];
  const section = html.slice(idx, idx + 6000);
  BREADCRUMB_NAME_RE.lastIndex = 0;
  const names = [];
  let m;
  while ((m = BREADCRUMB_NAME_RE.exec(section))) {
    const text = he.decode(m[1]).replace(/\s+/g, " ").trim();
    if (text && text !== "Página inicial") names.push(text);
  }
  return names;
}

function parsePricePerUnitFromHtml(html) {
  const secondary = html.match(PRICE_SECONDARY_RE);
  if (!secondary) return null;
  const text = he.decode(secondary[1]).replace(/<[^>]+>/g, " ");
  const value = text.match(PRICE_PER_UNIT_RE);
  return value ? Number(value[1].replace(",", ".")) : null;
}

// Devolve { product } em caso de sucesso ou { reason } quando exclui, para
// quem chama poder contar exatamente porque cada URL nao virou produto
// (pedido explicito: "produtos capturados vs excluidos e a razao de cada
// exclusao").
function parseProductDetailPage(html, url) {
  const ldMatch = html.match(LD_JSON_PRODUCT_RE);
  if (!ldMatch) return { reason: "sem_ld_json" };
  let data;
  try {
    data = JSON.parse(ldMatch[1]);
  } catch {
    return { reason: "erro_parse_json" };
  }
  if (!data.sku || !data.name || !data.offers) return { reason: "sem_dados_essenciais" };
  if (data.offers.availability && !/InStock/i.test(data.offers.availability)) return { reason: "fora_de_stock" };

  const price = Number(data.offers.price);
  if (!Number.isFinite(price) || price === 0) return { reason: "preco_zero_ou_invalido" };

  const breadcrumb = parseBreadcrumb(html);
  const classification = classifyContinenteBreadcrumb(breadcrumb);
  if (!classification) return { reason: "sem_classificacao", breadcrumb: breadcrumb.join(" / ") };

  const image = Array.isArray(data.image) ? data.image[0] : data.image;

  return {
    product: {
      id: String(data.sku),
      name: data.name,
      brand: data.brand?.name || null,
      price,
      pricePerUnit: parsePricePerUnitFromHtml(html),
      url,
      imageUrl: image || null,
      category: classification.category,
      subcategory: classification.subcategory,
    },
  };
}

// So sitemap_1-product.xml (~20000 URLs) - ver nota acima. Concorrencia
// controlada dado o volume, muito acima dos 369 pedidos de
// fetchCategoryProducts. "urls" permite passar uma lista ja filtrada (para
// retomar uma corrida interrompida sem repetir URLs ja gravados).
export async function* fetchSitemapProducts({
  onProductError,
  onExcluded,
  onProgress,
  concurrency = envInt("CONTINENTE_CONCURRENCY", 2),
  delayMs = envInt("CONTINENTE_DELAY_MS", 1000),
  urls: urlsOverride,
} = {}) {
  const urls = urlsOverride ?? (await collectSitemapProductUrls());
  onProgress?.({ phase: "urls-collected", total: urls.length });

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const html = await fetchText(url);
          const result = parseProductDetailPage(html, url);
          if (!result.product) onExcluded?.(url, result.reason);
          return result.product ?? null;
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

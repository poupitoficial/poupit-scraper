import "dotenv/config";
import { supabase } from "./supabase.js";
import { fetchAuchanProducts, collectRelevantProductUrls, MAX_PRODUCT_PRICE } from "./auchanClient.js";
import { priceChanged } from "./priceHistory.js";
import { extractQuantity } from "./quantityExtractor.js";
import { normalizeBrand } from "./brandAliases.js";

const SLUG = "auchan";
// URLs do Auchan sao .../{slug-do-produto}/{sku}.html (sku isolado no seu
// proprio segmento, ao contrario do Continente que tem "-{id}.html" colado
// ao slug) - regex sem exigir hifen antes do numero.
const ID_FROM_URL_RE = /\/(\d+)\.html$/;

async function getSupermarketId() {
  const { data, error } = await supabase.from("supermarkets").select("id").eq("slug", SLUG).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const { data: created, error: insertError } = await supabase
    .from("supermarkets")
    .insert({ name: "Auchan", slug: SLUG })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function upsertProduct({
  externalId,
  name,
  brand,
  category,
  subcategory,
  price,
  pricePerUnit,
  url,
  imageUrl,
  barcode,
  supermarketId,
}) {
  const { data: existing, error: findError } = await supabase
    .from("supermarket_products")
    .select("id, product_id, current_price")
    .eq("supermarket_id", supermarketId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (findError) throw findError;

  let productId = existing?.product_id;
  const qty = extractQuantity(name);
  const normalizedBrand = brand ? normalizeBrand(brand) : null;

  if (!productId) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({ name, brand: normalizedBrand, category, subcategory, subcategory_source: subcategory ? "breadcrumb" : null, image_url: imageUrl, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null, barcode: barcode || null })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = product.id;
  } else {
    const update = { category, subcategory, subcategory_source: subcategory ? "breadcrumb" : null, brand: normalizedBrand, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null };
    if (imageUrl) update.image_url = imageUrl;
    if (barcode) update.barcode = barcode;
    const { error: updateError } = await supabase.from("products").update(update).eq("id", productId);
    if (updateError) throw updateError;
  }

  const { data: sp, error: upsertError } = await supabase
    .from("supermarket_products")
    .upsert(
      {
        id: existing?.id,
        product_id: productId,
        supermarket_id: supermarketId,
        external_id: externalId,
        url,
        current_price: price,
        current_price_per_unit: pricePerUnit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "product_id,supermarket_id" }
    )
    .select("id")
    .single();
  if (upsertError) throw upsertError;

  if (priceChanged(existing?.current_price, price)) {
    const { error: priceError } = await supabase
      .from("prices")
      .insert({ supermarket_product_id: sp.id, price, price_per_unit: pricePerUnit });
    if (priceError) throw priceError;
  }
}

// Le todos os external_id ja gravados para este supermercado, para poder
// retomar uma corrida que morreu a meio sem repetir os pedidos ja feitos -
// mesmo mecanismo de src/continenteSitemapIndex.js (motivado por uma corrida
// real que parou a meio nesta sessao, sem esta logica teria de reprocessar
// os 22000+ URLs do zero). NOTA: isto e para retomar uma descoberta de
// catalogo interrompida, nao para refrescar precos - produtos ja na BD nao
// sao revisitados, por isso nao serve para atualizacoes de preco do dia a
// dia (usar uma corrida normal sem filtro para isso).
async function getExistingExternalIds(supermarketId) {
  const ids = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from("supermarket_products").select("external_id").eq("supermarket_id", supermarketId).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) ids.add(r.external_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function main() {
  const supermarketId = await getSupermarketId();
  const summary = { found: 0, saved: 0, ignoredPrice: 0, errors: 0 };
  const seen = new Set();

  const [allUrls, existingIds] = await Promise.all([collectRelevantProductUrls(), getExistingExternalIds(supermarketId)]);
  const remaining = allUrls.filter((u) => {
    const m = u.match(ID_FROM_URL_RE);
    return !m || !existingIds.has(m[1]);
  });
  console.log(`${allUrls.length} URLs de produto relevantes no sitemap, ${existingIds.size} produtos Auchan ja na BD, ${remaining.length} por processar nesta corrida.`);

  const onProductError = (url, err) => {
    summary.errors += 1;
    console.error(`Falha a carregar produto "${url}": ${err.message}`);
  };
  const onProgress = (info) => {
    if (info.phase === "batch-done" && (info.processed % 1000 === 0 || info.processed === info.total)) {
      console.log(`... ${info.processed}/${info.total} paginas de produto processadas`);
    }
  };

  for await (const p of fetchAuchanProducts({ onProductError, onProgress, urls: remaining })) {
    summary.found += 1;
    if (typeof p.price !== "number" || p.price >= MAX_PRODUCT_PRICE) {
      summary.ignoredPrice += 1;
      continue;
    }
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    try {
      await upsertProduct({
        externalId: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        subcategory: p.subcategory,
        price: p.price,
        pricePerUnit: p.pricePerUnit,
        url: p.url,
        imageUrl: p.imageUrl,
        barcode: p.barcode,
        supermarketId,
      });
      summary.saved += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`Erro ao gravar ${p.id} (${p.name}): ${err.message}`);
    }

    if (summary.found % 500 === 0) {
      console.log(`... progresso: ${summary.found} processados, ${summary.saved} guardados`);
    }
  }

  console.log("--- Resumo Auchan ---");
  console.log(`Encontrados: ${summary.found}`);
  console.log(`Guardados/atualizados: ${summary.saved}`);
  console.log(`Ignorados (preco >= ${MAX_PRODUCT_PRICE}e): ${summary.ignoredPrice}`);
  console.log(`Erros: ${summary.errors}`);

  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

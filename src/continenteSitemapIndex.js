// Corre a via sitemap+PDP do Continente (sitemap_1-product.xml, ~20000
// URLs), complementar ao scraper de categorias existente (src/index.js, que
// continua a cobrir bebidas). Ao contrario dos scripts resume_*.mjs usados
// esta sessao para Auchan/Pingo Doce, a retoma esta embutida de raiz: no
// arranque filtra logo os URLs cujo ID ja esta na BD, por isso correr este
// ficheiro outra vez depois de uma morte a meio (ja aconteceu 2x nesta
// sessao com corridas longas sem output) retoma automaticamente do que
// falta, sem precisar de um script de retoma separado.
import "dotenv/config";
import { supabase } from "./supabase.js";
import { collectSitemapProductUrls, fetchSitemapProducts, MAX_PRODUCT_PRICE } from "./continenteClient.js";
import { priceChanged } from "./priceHistory.js";
import { extractQuantity } from "./quantityExtractor.js";
import { normalizeBrand } from "./brandAliases.js";

const SLUG = "continente";
const ID_FROM_URL_RE = /-(\d+)\.html$/;

async function getSupermarketId() {
  const { data, error } = await supabase.from("supermarkets").select("id").eq("slug", SLUG).single();
  if (error || !data) throw new Error(`Supermercado "${SLUG}" nao encontrado: ${error?.message ?? "sem resultados"}`);
  return data.id;
}

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

async function upsertProduct({ externalId, name, brand, category, subcategory, price, pricePerUnit, url, imageUrl, supermarketId }) {
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
      .insert({ name, brand: normalizedBrand, category, subcategory, subcategory_source: subcategory ? "breadcrumb" : null, image_url: imageUrl, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = product.id;
  } else {
    const update = { category, subcategory, subcategory_source: subcategory ? "breadcrumb" : null, brand: normalizedBrand, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null };
    if (imageUrl) update.image_url = imageUrl;
    const { error: updateError } = await supabase.from("products").update(update).eq("id", productId);
    if (updateError) throw updateError;
  }

  const { data: sp, error: upsertError } = await supabase
    .from("supermarket_products")
    .upsert(
      { id: existing?.id, product_id: productId, supermarket_id: supermarketId, external_id: externalId, url, current_price: price, current_price_per_unit: pricePerUnit, updated_at: new Date().toISOString() },
      { onConflict: "product_id,supermarket_id" }
    )
    .select("id")
    .single();
  if (upsertError) throw upsertError;

  if (priceChanged(existing?.current_price, price)) {
    const { error: priceError } = await supabase.from("prices").insert({ supermarket_product_id: sp.id, price, price_per_unit: pricePerUnit });
    if (priceError) throw priceError;
  }
}

async function main() {
  const t0 = Date.now();
  const supermarketId = await getSupermarketId();

  const [allUrls, existingIds] = await Promise.all([collectSitemapProductUrls(), getExistingExternalIds(supermarketId)]);
  const remaining = allUrls.filter((u) => {
    const m = u.match(ID_FROM_URL_RE);
    return !m || !existingIds.has(m[1]);
  });
  console.log(`${allUrls.length} URLs no sitemap_1, ${existingIds.size} produtos Continente ja na BD, ${remaining.length} por processar nesta corrida.`);

  const summary = { found: 0, saved: 0, ignoredPrice: 0, errors: 0 };
  const exclusionReasons = {};
  const seen = new Set();

  const onProductError = (url, err) => {
    summary.errors++;
    exclusionReasons.erro_rede = (exclusionReasons.erro_rede || 0) + 1;
    console.error(`Erro de rede em "${url}": ${err.message}`);
  };
  const onExcluded = (url, reason) => {
    exclusionReasons[reason] = (exclusionReasons[reason] || 0) + 1;
  };
  const onProgress = (info) => {
    if (info.phase === "batch-done" && (info.processed % 1000 === 0 || info.processed === info.total)) {
      const elapsedMin = (Date.now() - t0) / 60000;
      console.log(`... ${info.processed}/${info.total} processados (${elapsedMin.toFixed(1)} min decorridos, ${summary.saved} guardados ate agora)`);
    }
  };

  for await (const p of fetchSitemapProducts({ onProductError, onExcluded, onProgress, urls: remaining })) {
    summary.found++;
    if (typeof p.price !== "number" || p.price >= MAX_PRODUCT_PRICE) {
      summary.ignoredPrice++;
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
        supermarketId,
      });
      summary.saved++;
    } catch (err) {
      summary.errors++;
      console.error(`Erro ao gravar ${p.id} (${p.name}): ${err.message}`);
    }
  }

  const elapsedMin = (Date.now() - t0) / 60000;
  console.log("\n--- Resumo (via sitemap_1) ---");
  console.log(`Tempo real: ${elapsedMin.toFixed(1)} min`);
  console.log(`URLs processados nesta corrida: ${remaining.length}`);
  console.log(`Encontrados (validos): ${summary.found}`);
  console.log(`Guardados/atualizados: ${summary.saved}`);
  console.log(`Ignorados (preco >= ${MAX_PRODUCT_PRICE}e): ${summary.ignoredPrice}`);
  console.log(`Erros: ${summary.errors}`);
  console.log(`\nExclusoes por razao:`);
  for (const [reason, count] of Object.entries(exclusionReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

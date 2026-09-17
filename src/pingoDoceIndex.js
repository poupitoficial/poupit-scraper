import "dotenv/config";
import { supabase } from "./supabase.js";
import { fetchPingoDoceProducts, collectRelevantProductUrls, MAX_PRODUCT_PRICE, MIN_PRODUCT_PRICE } from "./pingoDoceClient.js";
import { priceChanged } from "./priceHistory.js";
import { extractQuantity } from "./quantityExtractor.js";
import { normalizeBrand } from "./brandAliases.js";

const SLUG = "pingo-doce";
const ID_FROM_URL_RE = /-(\d+)\.html$/;
// A corrida completa (~9800 produtos, sequencial) demora mais do que o
// limite de duracao de uma tarefa em background desta plataforma (~50-70
// min, confirmado empiricamente - morreu 2x sem erro nenhum do scraper,
// uma vez com exit 4 aos 3600, outra com exit 0 aos ~4800 sem chegar ao
// resumo final). Sem isto, cada relançamento reprocessava tudo do zero e
// nunca se chegava ao fim. So salta o que foi tocado MUITO recentemente
// (esta corrida ou a anterior, ainda a "quente") - nao e o mesmo filtro
// "ja existe na BD" do Auchan/Continente (esse serve para descoberta de
// catalogo, nao para refresh - iria saltar tudo e nao atualizava nada).
const RECENT_MINUTES = 90;

async function getSupermarketId() {
  const { data, error } = await supabase.from("supermarkets").select("id").eq("slug", SLUG).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const { data: created, error: insertError } = await supabase
    .from("supermarkets")
    .insert({ name: "Pingo Doce", slug: SLUG })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function upsertProduct({
  externalId,
  name,
  category,
  subcategory,
  price,
  pricePerUnit,
  url,
  imageUrl,
  brand,
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
      .insert({ name, category, subcategory, subcategory_source: subcategory ? "breadcrumb" : null, image_url: imageUrl, brand: normalizedBrand, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null })
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

async function getRecentlyUpdatedExternalIds(supermarketId) {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - RECENT_MINUTES);
  const ids = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("supermarket_products")
      .select("external_id")
      .eq("supermarket_id", supermarketId)
      .gte("updated_at", cutoff.toISOString())
      .range(from, from + 999);
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

  const [allUrls, recentIds] = await Promise.all([collectRelevantProductUrls(), getRecentlyUpdatedExternalIds(supermarketId)]);
  const remaining = allUrls.filter((u) => {
    const m = u.url.match(ID_FROM_URL_RE);
    return !m || !recentIds.has(m[1]);
  });
  console.log(`${allUrls.length} URLs relevantes, ${recentIds.size} atualizados nos ultimos ${RECENT_MINUTES}min (saltados), ${remaining.length} por processar nesta corrida.`);

  const onProductError = (url, err) => {
    summary.errors += 1;
    console.error(`Erro em ${url}: ${err.message}`);
  };

  for await (const p of fetchPingoDoceProducts({ onProductError, urls: remaining })) {
    summary.found += 1;
    if (typeof p.price !== "number" || p.price >= MAX_PRODUCT_PRICE || p.price < MIN_PRODUCT_PRICE) {
      summary.ignoredPrice += 1;
      continue;
    }
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    try {
      await upsertProduct({
        externalId: p.id,
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        price: p.price,
        pricePerUnit: p.pricePerUnit,
        url: p.url,
        imageUrl: p.imageUrl,
        brand: p.brand,
        supermarketId,
      });
      summary.saved += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`Erro ao gravar ${p.id} (${p.name}): ${err.message}`);
    }

    if (summary.found % 200 === 0) {
      console.log(`... progresso: ${summary.found} processados, ${summary.saved} guardados`);
    }
  }

  console.log("--- Resumo Pingo Doce ---");
  console.log(`Encontrados: ${summary.found}`);
  console.log(`Guardados/atualizados: ${summary.saved}`);
  console.log(`Ignorados (preco >= ${MAX_PRODUCT_PRICE}e ou < ${MIN_PRODUCT_PRICE}e): ${summary.ignoredPrice}`);
  console.log(`Erros: ${summary.errors}`);

  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

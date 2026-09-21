import "dotenv/config";
import { supabase } from "./supabase.js";
import { fetchAldiProducts, MAX_PRODUCT_PRICE } from "./aldiClient.js";
import { priceChanged } from "./priceHistory.js";
import { extractQuantity } from "./quantityExtractor.js";
import { normalizeBrand } from "./brandAliases.js";
import { setExitCodeFromErrors } from "./runGuards.js";

const SLUG = "aldi";

async function getSupermarketId() {
  const { data, error } = await supabase.from("supermarkets").select("id").eq("slug", SLUG).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const { data: created, error: insertError } = await supabase
    .from("supermarkets")
    .insert({ name: "Aldi", slug: SLUG })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
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
      .insert({ name, brand: normalizedBrand, category, subcategory, subcategory_source: subcategory ? "nome" : null, image_url: imageUrl, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = product.id;
  } else {
    const update = { category, subcategory, subcategory_source: subcategory ? "nome" : null, brand: normalizedBrand, unit_type: qty?.unit ?? null, unit_size: qty?.value ?? null };
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
  const supermarketId = await getSupermarketId();
  const summary = { found: 0, saved: 0, ignoredPrice: 0, errors: 0 };
  const seen = new Set();

  const onProductError = (url, err) => {
    summary.errors += 1;
    console.error(`Falha a carregar produto "${url}": ${err.message}`);
  };
  const onProgress = (info) => {
    if (info.phase === "urls-collected") console.log(`${info.total} URLs de produto no sitemap.`);
  };

  for await (const p of fetchAldiProducts({ onProductError, onProgress })) {
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
        supermarketId,
      });
      summary.saved += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`Erro ao gravar ${p.id} (${p.name}): ${err.message}`);
    }
  }

  console.log("--- Resumo Aldi ---");
  console.log(`Encontrados: ${summary.found}`);
  console.log(`Guardados/atualizados: ${summary.saved}`);
  console.log(`Ignorados (preco >= ${MAX_PRODUCT_PRICE}e): ${summary.ignoredPrice}`);
  console.log(`Erros: ${summary.errors}`);

  setExitCodeFromErrors(summary.errors, summary.found + summary.errors);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

import "dotenv/config";
import { supabase } from "./supabase.js";
import { fetchCategoryProducts, MAX_PRODUCT_PRICE } from "./continenteClient.js";

const SUPERMARKET_SLUG = process.env.CONTINENTE_SUPERMARKET_SLUG || "continente";

async function getSupermarketId() {
  const { data, error } = await supabase
    .from("supermarkets")
    .select("id")
    .eq("slug", SUPERMARKET_SLUG)
    .single();

  if (error || !data) {
    throw new Error(
      `Supermercado "${SUPERMARKET_SLUG}" nao encontrado na tabela supermarkets: ${error?.message ?? "sem resultados"}`
    );
  }
  return data.id;
}

async function upsertProduct({
  externalId,
  name,
  category,
  price,
  pricePerUnit,
  url,
  imageUrl,
  supermarketId,
}) {
  const { data: existing, error: findError } = await supabase
    .from("supermarket_products")
    .select("id, product_id")
    .eq("supermarket_id", supermarketId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (findError) throw findError;

  let productId = existing?.product_id;

  if (!productId) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({ name, category, image_url: imageUrl })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = product.id;
  } else if (imageUrl) {
    // backfill de produtos ja existentes que ainda nao tinham image_url
    const { error: imageError } = await supabase
      .from("products")
      .update({ image_url: imageUrl })
      .eq("id", productId);
    if (imageError) throw imageError;
  }

  const { data: supermarketProduct, error: upsertError } = await supabase
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

  const { error: priceError } = await supabase.from("prices").insert({
    supermarket_product_id: supermarketProduct.id,
    price,
    price_per_unit: pricePerUnit,
  });
  if (priceError) throw priceError;
}

async function main() {
  const supermarketId = await getSupermarketId();

  const summary = {
    found: 0,
    saved: 0,
    ignoredPrice: 0,
    ignoredCategory: 0,
    errors: 0,
  };
  const seen = new Set();

  const onCategoryError = (url, err) => {
    summary.errors += 1;
    console.error(`Falha a carregar categoria "${url}": ${err.message}`);
  };

  for await (const tile of fetchCategoryProducts({ onCategoryError })) {
    summary.found += 1;

    if (!tile.category) {
      summary.ignoredCategory += 1;
      continue;
    }
    if (typeof tile.price !== "number" || tile.price >= MAX_PRODUCT_PRICE) {
      summary.ignoredPrice += 1;
      continue;
    }
    if (seen.has(tile.id)) continue;
    seen.add(tile.id);

    try {
      await upsertProduct({
        externalId: String(tile.id),
        name: tile.name,
        category: tile.category,
        price: tile.price,
        pricePerUnit: tile.pricePerUnit ?? null,
        url: tile.url ?? null,
        imageUrl: tile.imageUrl ?? null,
        supermarketId,
      });
      summary.saved += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`Erro no produto ${tile.id} (${tile.name}): ${err.message}`);
    }
  }

  console.log("--- Resumo ---");
  console.log(`Produtos encontrados: ${summary.found}`);
  console.log(`Guardados/atualizados: ${summary.saved}`);
  console.log(`Ignorados (preco >= ${MAX_PRODUCT_PRICE}e): ${summary.ignoredPrice}`);
  console.log(`Ignorados (categoria desconhecida): ${summary.ignoredCategory}`);
  console.log(`Erros: ${summary.errors}`);

  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

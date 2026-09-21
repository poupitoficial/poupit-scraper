import "dotenv/config";
import { supabase } from "./supabase.js";
import { fetchPingoDoceProducts, collectRelevantProductUrls, MAX_PRODUCT_PRICE, MIN_PRODUCT_PRICE } from "./pingoDoceClient.js";
import { priceChanged } from "./priceHistory.js";
import { extractQuantity } from "./quantityExtractor.js";
import { normalizeBrand } from "./brandAliases.js";
import { setExitCodeFromErrors, deadlineFromEnv, pastDeadline } from "./runGuards.js";

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

async function getUpdatedAtByExternalId(supermarketId) {
  const map = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("supermarket_products")
      .select("external_id, updated_at")
      .eq("supermarket_id", supermarketId)
      .range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) map.set(r.external_id, r.updated_at);
    if (data.length < 1000) break;
    from += 1000;
  }
  return map;
}

async function main() {
  const supermarketId = await getSupermarketId();
  const summary = { found: 0, saved: 0, ignoredPrice: 0, errors: 0 };
  const seen = new Set();
  const deadline = deadlineFromEnv();

  const [allUrls, updatedAt] = await Promise.all([collectRelevantProductUrls(), getUpdatedAtByExternalId(supermarketId)]);
  const recentCutoff = new Date(Date.now() - RECENT_MINUTES * 60_000).toISOString();
  const idOf = (u) => u.url.match(ID_FROM_URL_RE)?.[1];
  // Produtos novos primeiro, depois do preco mais antigo para o mais recente.
  // O catalogo completo nao cabe num job do CI; com esta ordem e o
  // SCRAPE_TIME_BUDGET_MIN, cada corrida diaria pega no que esta ha mais tempo
  // sem atualizar e o catalogo inteiro vai rodando ao longo de dias seguidos,
  // em vez de o job ser morto a meio sempre nos mesmos produtos.
  const remaining = allUrls
    .filter((u) => {
      const t = updatedAt.get(idOf(u));
      return !t || t < recentCutoff;
    })
    .sort((a, b) => (updatedAt.get(idOf(a)) ?? "").localeCompare(updatedAt.get(idOf(b)) ?? ""));
  console.log(
    `${allUrls.length} URLs relevantes, ${allUrls.length - remaining.length} atualizados nos ultimos ${RECENT_MINUTES}min (saltados), ` +
      `${remaining.length} por processar (mais antigos primeiro)${deadline ? `, limite ${process.env.SCRAPE_TIME_BUDGET_MIN}min` : ""}.`
  );

  const onProductError = (url, err) => {
    summary.errors += 1;
    console.error(`Erro em ${url}: ${err.message}`);
  };

  for await (const p of fetchPingoDoceProducts({ onProductError, urls: remaining })) {
    if (pastDeadline(deadline)) {
      console.log(`Limite de tempo atingido - a parar aqui (${summary.found}/${remaining.length}); o resto fica para a proxima corrida.`);
      break;
    }
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

  setExitCodeFromErrors(summary.errors, summary.found + summary.errors);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

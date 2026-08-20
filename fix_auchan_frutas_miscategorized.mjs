// Reclassifica na BD os produtos Auchan miscategorizados como frutas_legumes
// (chocolate->frutos_secos, sumo->fruta) usando o breadcrumb real (ld+json),
// sem precisar de re-correr o scraper completo (30403 URLs).
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { classifyAuchanBreadcrumb } from "./src/auchanCategoryMap.js";

const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const SUSPECT_RE = /chocolate|bolach|creme|iogurte|queijo|leite|manteiga|cerveja|vinho|sumo|refrigerante|sabonete|champo|detergente|papel higienico|racao|croissant/i;

async function fetchBreadcrumb(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)" },
  });
  const html = await res.text();
  const blocks = [];
  let m;
  LD_JSON_RE.lastIndex = 0;
  while ((m = LD_JSON_RE.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {}
  }
  const bc = blocks.find((b) => b["@type"] === "BreadcrumbList");
  return (bc?.itemListElement || []).sort((a, b) => a.position - b.position).map((c) => c.item?.name).filter(Boolean);
}

async function main() {
  const { data: sm } = await supabase.from("supermarkets").select("id").eq("slug", "auchan").single();

  // ids Auchan de produtos com category=frutas_legumes
  let from = 0;
  const spIds = [];
  while (true) {
    const { data } = await supabase.from("supermarket_products").select("product_id, external_id, url").eq("supermarket_id", sm.id).range(from, from + 999);
    if (!data.length) break;
    spIds.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const frutasProducts = [];
  for (let i = 0; i < spIds.length; i += 300) {
    const batch = spIds.slice(i, i + 300);
    const { data } = await supabase.from("products").select("id, name, category, subcategory").in("id", batch.map((r) => r.product_id)).eq("category", "frutas_legumes");
    for (const p of data) {
      const sp = batch.find((r) => r.product_id === p.id);
      frutasProducts.push({ ...p, url: sp.url });
    }
  }
  console.log(`${frutasProducts.length} produtos Auchan com category=frutas_legumes na BD.`);

  const suspects = frutasProducts.filter((p) => SUSPECT_RE.test(p.name));
  console.log(`${suspects.length} suspeitos a reclassificar.`);

  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  const changes = [];

  const CONCURRENCY = 10;
  for (let i = 0; i < suspects.length; i += CONCURRENCY) {
    const batch = suspects.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const crumbs = await fetchBreadcrumb(p.url);
          const result = classifyAuchanBreadcrumb(...crumbs);
          if (!result) return; // sem classificacao, deixa como estava
          if (result.category === p.category && result.subcategory === p.subcategory) {
            unchanged++;
            return;
          }
          const { error } = await supabase.from("products").update({ category: result.category, subcategory: result.subcategory }).eq("id", p.id);
          if (error) throw error;
          changed++;
          changes.push(`${p.name}: ${p.category}/${p.subcategory} -> ${result.category}/${result.subcategory}`);
        } catch (err) {
          errors++;
          console.error(`Erro em "${p.name}": ${err.message}`);
        }
      })
    );
    if ((i / CONCURRENCY) % 5 === 0) console.log(`... ${Math.min(i + CONCURRENCY, suspects.length)}/${suspects.length} processados`);
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Reclassificados: ${changed}`);
  console.log(`Mantidos (breadcrumb ja correto ou sem match): ${unchanged}`);
  console.log(`Erros: ${errors}`);
  console.log(`\nAmostra de mudancas:`);
  for (const c of changes.slice(0, 20)) console.log("  " + c);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

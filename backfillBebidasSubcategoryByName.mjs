// Backfill pontual: subcategoria dos produtos de bebidas do Continente sem
// subcategoria (paginas de vinho/garrafeira nao tem breadcrumb, ver
// continenteClient.js). Classificacao por nome (src/bebidasNameClassifier.js),
// aprovada pelo utilizador - NAO substitui breadcrumb onde existe, e marca
// subcategory_source='nome' para se distinguir das restantes (migracao 020,
// que tem de ser aplicada primeiro).
//
// So toca em produtos do Continente (via supermarket_products) - outras lojas
// nao tem este problema de paginas sem breadcrumb.
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { classifyBebidaByName } from "./src/bebidasNameClassifier.js";

async function getContinenteProductIds() {
  const { data: sm, error: smError } = await supabase.from("supermarkets").select("id").eq("slug", "continente").single();
  if (smError || !sm) throw new Error(`Supermercado "continente" nao encontrado: ${smError?.message ?? "sem resultados"}`);

  const ids = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from("supermarket_products").select("product_id").eq("supermarket_id", sm.id).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) ids.add(r.product_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function main() {
  const continenteIds = await getContinenteProductIds();
  console.log(`${continenteIds.size} produtos Continente na BD.`);

  const pageSize = 1000;
  let from = 0;
  let scanned = 0;
  let updated = 0;
  let errors = 0;
  const counts = {};
  const unclassified = [];

  while (true) {
    // paginacao por id sobre TODOS os produtos "bebidas" (sem filtrar
    // subcategory=null), pela mesma razao de backfillUnitFields.mjs: um
    // update a meio da paginacao desalinharia "from" se filtrassemos.
    const { data, error } = await supabase.from("products").select("id, name, category, subcategory").eq("category", "bebidas").order("id").range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;

    for (const p of data) {
      scanned++;
      if (p.subcategory != null) continue; // ja classificado (breadcrumb ou corrida anterior)
      if (!continenteIds.has(p.id)) continue; // so Continente

      const sub = classifyBebidaByName(p.name);
      if (!sub) {
        unclassified.push(p.name);
        continue;
      }

      const { error: updateError } = await supabase.from("products").update({ subcategory: sub, subcategory_source: "nome" }).eq("id", p.id);
      if (updateError) {
        errors++;
        console.error(`erro em "${p.name}": ${updateError.message}`);
      } else {
        updated++;
        counts[sub] = (counts[sub] || 0) + 1;
      }
    }
    console.log(`... ${scanned} produtos "bebidas" percorridos (${updated} atualizados ate agora)`);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log("\n--- Resumo ---");
  console.log(`Produtos "bebidas" percorridos: ${scanned}`);
  console.log(`Atualizados (subcategory_source='nome'): ${updated}`);
  for (const [sub, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sub}: ${count}`);
  }
  console.log(`Sem classificacao: ${unclassified.length}`);
  unclassified.forEach((n) => console.log("  ", n));
  console.log(`Erros: ${errors}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

// Reaudita matched_products (refrigerantes_sumos/agua, confidence=high) contra
// o novo packCountDiverges() de scripts/matchLib.mjs - motivado por um caso
// real reportado pelo utilizador: "Ice Tea Pessego Pack 6" (Lipton)
// emparelhado com "Ice Tea Pessego" sem pack, Continente 1,79e vs Pingo
// Doce 5,34e, estavel ha 2 semanas (embalagens diferentes, nao staleness).
//
// Lista de reaudit = uniao de dois metodos complementares (diag_pack_*.json,
// gerados manualmente antes de correr isto):
//  1. Pares que sobreviviam ao matching antigo mas nao ao novo (comparacao
//     old-vs-new contra os dados locais atuais).
//  2. Qualquer match=high nestas subcategorias cujo NOME CANONICO tem um
//     marcador de pack (>1) - matched_products so guarda um nome, nao os
//     dois lados originais, por isso nao da para reverificar o par exato;
//     um nome com "Pack N" e suspeito por definicao sob o criterio novo.
// Mesmo padrao de reaudit_fraldas_range_bug.mjs: move para
// matched_products_review (status=reaudit_pending), nunca apaga.
import fs from "node:fs";
import "dotenv/config";
import { supabase } from "./src/supabase.js";

async function main() {
  const union = JSON.parse(fs.readFileSync("diag_pack_reaudit_union.json", "utf-8"));
  console.log(`${union.length} matches a mover para matched_products_review (status=reaudit_pending).`);

  let moved = 0, errors = 0;
  for (const row of union) {
    const { data: prices, error: pricesError } = await supabase.from("matched_prices").select("loja, preco").eq("product_id", row.id);
    if (pricesError) { console.error(`  erro a ler precos de "${row.name}": ${pricesError.message}`); errors++; continue; }
    const lojaA = prices?.[0]?.loja ?? "desconhecida";
    const lojaB = prices?.[1]?.loja ?? "desconhecida";
    const priceA = prices?.[0]?.preco ?? 0;
    const priceB = prices?.[1]?.preco ?? 0;

    const { data: mp } = await supabase.from("matched_products").select("*").eq("id", row.id).single();

    const { error: insError } = await supabase.from("matched_products_review").insert({
      loja_a: lojaA,
      loja_b: lojaB,
      match_score: mp.match_score ?? 0,
      name_a: mp.name,
      name_b: mp.name,
      brand: mp.brand,
      category: mp.category,
      quantity: mp.quantity,
      quantity_unit: mp.quantity_unit,
      price_a: priceA,
      price_b: priceB,
      image_url: mp.image_url,
      status: "reaudit_pending",
    });
    if (insError) { console.error(`  erro ao mover "${row.name}": ${insError.message}`); errors++; continue; }

    const { error: delPricesError } = await supabase.from("matched_prices").delete().eq("product_id", row.id);
    if (delPricesError) console.error(`  erro ao apagar precos de "${row.name}": ${delPricesError.message}`);
    const { error: delMpError } = await supabase.from("matched_products").delete().eq("id", row.id);
    if (delMpError) console.error(`  erro ao apagar matched_products "${row.name}": ${delMpError.message}`);
    moved++;
    console.log(`  movido: "${row.name}" (${row.brand}) [${lojaA} ${priceA}e <-> ${lojaB} ${priceB}e]`);
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Movidos para reaudit_pending: ${moved}`);
  console.log(`Erros: ${errors}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

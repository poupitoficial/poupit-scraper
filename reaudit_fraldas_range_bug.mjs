// Reaudita matched_products (fraldas/cuecas, confidence=high) aprovados
// antes do fix ao extractQuantity() (src/quantityExtractor.js e
// scripts/matchLib.mjs) que lia o intervalo de peso do bebe no nome
// ("9-15kg") como se fosse o peso do produto - ver auditoria de precos
// desta sessao. Mesmo padrao do reaudit_frutas_legumes.mjs: compara contra
// o resultado do matching JA corrido com o fix (analysis/matches_*.json,
// regenerados por matchAll.mjs depois do fix) - quem nao sobrevive como
// match de alta confianca e movido para matched_products_review
// (status=reaudit_pending), nunca apagado sem rasto.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { isSafeFrutasLegumesOwnBrand } from "./scripts/matchLib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const PAIRS = [
  ["continente", "pingo-doce"], ["continente", "lidl"], ["continente", "auchan"],
  ["pingo-doce", "lidl"], ["pingo-doce", "auchan"], ["lidl", "auchan"],
  ["continente", "aldi"], ["pingo-doce", "aldi"], ["lidl", "aldi"], ["auchan", "aldi"],
];

const key = (name, brand) => `${name.trim().toLowerCase()}|${(brand || "").trim().toLowerCase()}`;

async function main() {
  const survivorKeys = new Set();
  for (const [a, b] of PAIRS) {
    const file = path.join(root, "analysis", `matches_${a}_${b}.json`);
    if (!fs.existsSync(file)) continue;
    const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const m of matches) {
      if (!m || !m.a || !m.b) continue;
      const isFrutas = m.a.category === "frutas_legumes" || m.b.category === "frutas_legumes";
      if (m.ownBrand && !isFrutas) continue;
      const isHigh = isFrutas && m.ownBrand ? isSafeFrutasLegumesOwnBrand(m) : m.score >= HIGH_CONFIDENCE_THRESHOLD;
      if (!isHigh) continue;
      survivorKeys.add(key(m.a.name, m.a.brand || m.b.brand || ""));
    }
  }
  console.log(`${survivorKeys.size} pares de alta confianca sobrevivem ao fix (todas as categorias).`);

  const { data: approved, error } = await supabase
    .from("matched_products")
    .select("id, name, brand, confidence, category")
    .or("name.ilike.%fralda%,name.ilike.%cueca%")
    .eq("confidence", "high");
  if (error) throw error;
  console.log(`${approved.length} fraldas/cuecas confidence=high em matched_products.`);

  const casualties = approved.filter((row) => !survivorKeys.has(key(row.name, row.brand)));
  console.log(`${casualties.length} deixam de validar apos o fix - a mover para matched_products_review (status=reaudit_pending).`);

  let moved = 0, errors = 0;
  for (const row of casualties) {
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
    if (insError) {
      console.error(`  erro ao mover "${row.name}": ${insError.message}`);
      errors++;
      continue;
    }
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

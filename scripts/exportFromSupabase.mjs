// Exporta o estado atual (ja em producao, ja corrigido/reclassificado) de cada
// supermercado para o mesmo formato JSON que scripts/harvestContinente.mjs e
// scripts/harvestPingoDoce.mjs geravam a partir do scraping direto. Mais rapido
// e mais fiavel do que voltar a fazer scraping so para o matching, porque usa
// exatamente os dados que ja estao gravados (e corrigidos) na BD.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const slug = process.argv[2];
const outFile = process.argv[3];
if (!slug || !outFile) {
  console.error("uso: node scripts/exportFromSupabase.mjs <slug-supermercado> <ficheiro-saida.json>");
  process.exit(1);
}

const { data: sm, error: smError } = await supabase.from("supermarkets").select("id").eq("slug", slug).single();
if (smError || !sm) {
  console.error(`Supermercado "${slug}" nao encontrado:`, smError?.message);
  process.exit(1);
}

const pageSize = 1000;
let from = 0;
const out = [];

while (true) {
  const { data, error } = await supabase
    .from("supermarket_products")
    .select("external_id, url, current_price, current_price_per_unit, products(name, brand, category, subcategory, image_url)")
    .eq("supermarket_id", sm.id)
    .range(from, from + pageSize - 1);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  if (!data.length) break;

  for (const row of data) {
    out.push({
      id: row.external_id,
      name: row.products?.name,
      brand: row.products?.brand ?? null,
      category: row.products?.category ?? null,
      subcategory: row.products?.subcategory ?? null,
      price: row.current_price,
      pricePerUnit: row.current_price_per_unit,
      url: row.url,
      imageUrl: row.products?.image_url ?? null,
    });
  }

  if (data.length < pageSize) break;
  from += pageSize;
}

fs.writeFileSync(path.join(root, outFile), JSON.stringify(out, null, 2));
console.log(`[${slug}] ${out.length} produtos exportados para ${outFile}`);

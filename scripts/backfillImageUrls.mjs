// Preenche image_url em matched_products ja existentes (inseridos antes deste campo
// existir), casando por name+brand com o pd_products_full.json / continente_products_full.json.
// Corre so depois de aplicar supabase/matched_add_image_url.sql.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const pd = JSON.parse(fs.readFileSync(path.join(root, "pd_products_full.json")));
const ct = JSON.parse(fs.readFileSync(path.join(root, "continente_products_full.json")));

function key(name, brand) {
  return `${name.trim().toLowerCase()}|${(brand || "").trim().toLowerCase()}`;
}

const pdByKey = new Map(pd.map((p) => [key(p.name, p.brand), p]));
const ctByKey = new Map(ct.map((p) => [key(p.name, p.brand), p]));

const { data: rows, error } = await supabase
  .from("matched_products")
  .select("id,name,brand")
  .is("image_url", null);

if (error) {
  console.error("ERRO a ler matched_products:", error.message);
  process.exit(1);
}

console.log(`${rows.length} produtos sem image_url a processar...`);

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const k = key(row.name, row.brand);
  const imageUrl = pdByKey.get(k)?.imageUrl || ctByKey.get(k)?.imageUrl || null;
  if (!imageUrl) {
    skipped++;
    continue;
  }
  const { error: updateError } = await supabase
    .from("matched_products")
    .update({ image_url: imageUrl })
    .eq("id", row.id);
  if (updateError) {
    console.error(`ERRO a atualizar ${row.id} (${row.name}):`, updateError.message);
    continue;
  }
  updated++;
}

console.log(`\nCONCLUIDO: ${updated} atualizados, ${skipped} sem imagem encontrada (de ${rows.length}).`);

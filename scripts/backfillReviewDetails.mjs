// Preenche os campos por-loja novos (price_per_unit_a/b, quantity_a/b,
// url_a/b, image_url_a/b) nas entradas de matched_products_review que ja
// existiam antes desta coluna existir - insertMatchesAll.mjs so grava estes
// campos em linhas NOVAS, nao retroage as ja inseridas. Le os ficheiros
// analysis/matches_<a>_<b>.json (regenerados por matchAll.mjs, ja com
// pricePerUnit) e atualiza por (loja_a, loja_b, name_a, name_b).
// Precisa de supabase/014_matched_products_review_details.sql corrido.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const LOJA_NAME = { continente: "continente", "pingo-doce": "pingo_doce", lidl: "lidl", auchan: "auchan", aldi: "aldi" };
const PAIRS = [
  ["continente", "pingo-doce"],
  ["continente", "lidl"],
  ["continente", "auchan"],
  ["pingo-doce", "lidl"],
  ["pingo-doce", "auchan"],
  ["lidl", "auchan"],
  ["continente", "aldi"],
  ["pingo-doce", "aldi"],
  ["lidl", "aldi"],
  ["auchan", "aldi"],
];

async function main() {
  let totalUpdated = 0;
  let totalMissingInFile = 0;

  for (const [labelA, labelB] of PAIRS) {
    const file = path.join(root, "analysis", `matches_${labelA}_${labelB}.json`);
    if (!fs.existsSync(file)) continue;
    const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
    const byKey = new Map();
    for (const m of matches) byKey.set(`${m.a.name}|${m.b.name}`, m);

    const { data: rows, error } = await supabase
      .from("matched_products_review")
      .select("id, name_a, name_b, price_per_unit_a")
      .eq("loja_a", LOJA_NAME[labelA])
      .eq("loja_b", LOJA_NAME[labelB])
      .is("price_per_unit_a", null);
    if (error) throw error;
    if (!rows.length) continue;

    let updatedForPair = 0;
    for (const row of rows) {
      const m = byKey.get(`${row.name_a}|${row.name_b}`);
      if (!m) {
        totalMissingInFile++;
        continue;
      }
      const { error: updateError } = await supabase
        .from("matched_products_review")
        .update({
          price_per_unit_a: m.a.pricePerUnit ?? null,
          price_per_unit_b: m.b.pricePerUnit ?? null,
          quantity_a: m.a.qty?.qty ?? null,
          quantity_unit_a: m.a.qty?.kind ?? null,
          quantity_b: m.b.qty?.qty ?? null,
          quantity_unit_b: m.b.qty?.kind ?? null,
          url_a: m.a.url ?? null,
          url_b: m.b.url ?? null,
          image_url_a: m.a.imageUrl ?? null,
          image_url_b: m.b.imageUrl ?? null,
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      updatedForPair++;
    }
    console.log(`${labelA} x ${labelB}: ${updatedForPair}/${rows.length} atualizados.`);
    totalUpdated += updatedForPair;
  }

  console.log(`\nTotal atualizado: ${totalUpdated}`);
  if (totalMissingInFile) console.log(`Nao encontrados no ficheiro de matches atual (produto pode ter mudado de nome desde a insercao): ${totalMissingInFile}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

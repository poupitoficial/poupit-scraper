// Normaliza a marca de todos os produtos ja existentes na BD, usando
// src/brandAliases.js - sem isto so os produtos gravados a partir de agora
// (proximos scrapes) ficariam normalizados.
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { normalizeBrand } from "./src/brandAliases.js";

async function main() {
  const pageSize = 1000;
  let from = 0;
  let total = 0;
  let updated = 0;
  let errors = 0;

  while (true) {
    const { data, error } = await supabase.from("products").select("id, brand").order("id").range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;

    for (const p of data) {
      total++;
      if (!p.brand) continue;
      const normalized = normalizeBrand(p.brand);
      if (normalized === p.brand) continue;
      const { error: updateError } = await supabase.from("products").update({ brand: normalized }).eq("id", p.id);
      if (updateError) {
        errors++;
        console.error(`erro em "${p.brand}": ${updateError.message}`);
      } else {
        updated++;
      }
    }
    console.log(`... ${total} processados (${updated} normalizados)`);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Total processados: ${total}`);
  console.log(`Marcas normalizadas: ${updated}`);
  console.log(`Erros: ${errors}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

// Preenche unit_type/unit_size em todos os produtos ja existentes na tabela
// products, a partir do nome (extractQuantity) - sem isto, so os produtos
// gravados a partir de agora (proximos scrapes) teriam estes campos.
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { extractQuantity } from "./src/quantityExtractor.js";

async function main() {
  const pageSize = 1000;
  let from = 0;
  let total = 0;
  let updated = 0;
  let skippedNoQty = 0;
  let errors = 0;

  while (true) {
    // paginacao por id SEM filtrar is(unit_type,null) - se filtrasse, cada
    // update tirava linhas do conjunto filtrado e desalinhava o "from" com
    // a proxima pagina (haveria linhas nunca visitadas). Paginar por tudo e
    // so pular o update quando ja preenchido garante que cada linha e vista
    // exatamente uma vez.
    const { data, error } = await supabase
      .from("products")
      .select("id, name, unit_type")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;

    for (const p of data) {
      total++;
      if (p.unit_type != null) continue; // ja preenchido (scrape recente ja passou por aqui)
      const qty = extractQuantity(p.name);
      if (!qty) {
        skippedNoQty++;
        continue;
      }
      const { error: updateError } = await supabase
        .from("products")
        .update({ unit_type: qty.unit, unit_size: qty.value })
        .eq("id", p.id);
      if (updateError) {
        errors++;
        console.error(`erro em "${p.name}": ${updateError.message}`);
      } else {
        updated++;
      }
    }
    console.log(`... ${total} processados (${updated} atualizados)`);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Total processados: ${total}`);
  console.log(`Atualizados (quantidade encontrada no nome): ${updated}`);
  console.log(`Sem quantidade explicita no nome: ${skippedNoQty}`);
  console.log(`Erros: ${errors}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

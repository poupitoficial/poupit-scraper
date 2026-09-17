// Reporta, por loja, ha quanto tempo os precos (supermarket_products.updated_at)
// estao desatualizados - usado para medir o impacto de uma corrida de refresh
// (baseline antes / depois). So leitura, nao toca em nada.
import "dotenv/config";
import { supabase } from "../src/supabase.js";

async function countOlderThan(supermarketId, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const { count, error } = await supabase
    .from("supermarket_products")
    .select("id", { count: "exact", head: true })
    .eq("supermarket_id", supermarketId)
    .lt("updated_at", cutoff.toISOString());
  if (error) throw error;
  return count;
}

async function main() {
  const { data: stores, error } = await supabase.from("supermarkets").select("id, slug").order("slug");
  if (error) throw error;

  const rows = [];
  for (const s of stores) {
    const { count: total, error: totalError } = await supabase
      .from("supermarket_products")
      .select("id", { count: "exact", head: true })
      .eq("supermarket_id", s.id);
    if (totalError) throw totalError;
    if (!total) continue; // loja sem produtos ainda (mercadona/intermarche/minipreco)

    const [over7, over14] = await Promise.all([countOlderThan(s.id, 7), countOlderThan(s.id, 14)]);

    const { data: oldest } = await supabase
      .from("supermarket_products")
      .select("updated_at")
      .eq("supermarket_id", s.id)
      .order("updated_at", { ascending: true })
      .limit(1);
    const { data: newest } = await supabase
      .from("supermarket_products")
      .select("updated_at")
      .eq("supermarket_id", s.id)
      .order("updated_at", { ascending: false })
      .limit(1);

    rows.push({
      loja: s.slug,
      total,
      "obsoletos >7d": `${over7} (${((100 * over7) / total).toFixed(1)}%)`,
      "obsoletos >14d": `${over14} (${((100 * over14) / total).toFixed(1)}%)`,
      "preco mais antigo": oldest?.[0]?.updated_at?.slice(0, 10) ?? "-",
      "preco mais recente": newest?.[0]?.updated_at?.slice(0, 10) ?? "-",
    });
  }

  console.log(`\n--- Frescura de precos (${new Date().toISOString().slice(0, 10)}) ---\n`);
  console.table(rows);
}

main().catch((err) => {
  console.error("Falha fatal:", err.message);
  process.exit(1);
});

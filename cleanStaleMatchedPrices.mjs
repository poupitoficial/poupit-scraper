// Apaga as linhas de matched_prices que ja nao correspondem ao cluster do
// produto.
//
// matched_prices so acrescenta: quando o cluster de um produto muda (uma loja
// deixa de ter o produto, um match passa a ser rejeitado, ou - no caso que
// motivou isto - corridas antigas do pipeline por par juntavam lojas a mais),
// os precos das lojas que sairam ficam la para sempre. A app le o preco mais
// recente por (produto, loja), por isso passa a mostrar comparacoes com lojas
// que ja nao estao associadas ao produto: 39 produtos apareciam com 4 lojas
// quando so 10 as tem de facto.
//
// Apaga duas coisas:
//   1. precos de uma loja que nao esta no cluster atual do produto;
//   2. precos de produtos que nao tem cluster nenhum (matched_product_sources
//      vazio) - sobras do pipeline antigo, ja sem forma de serem atualizadas.
//
// Dry-run por omissao. So escreve com --apply.
import "dotenv/config";
import { supabase } from "./src/supabase.js";

const APPLY = process.argv.includes("--apply");

async function fetchAll(table, cols) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

const sources = await fetchAll("matched_product_sources", "product_id, loja");
const prices = await fetchAll("matched_prices", "id, product_id, loja");

const clusterLojas = new Map();
for (const s of sources) {
  if (!clusterLojas.has(s.product_id)) clusterLojas.set(s.product_id, new Set());
  clusterLojas.get(s.product_id).add(s.loja);
}

const staleLojaIds = [];
const orphanIds = [];
for (const p of prices) {
  const lojas = clusterLojas.get(p.product_id);
  if (!lojas) orphanIds.push(p.id);
  else if (!lojas.has(p.loja)) staleLojaIds.push(p.id);
}

console.log(`matched_prices: ${prices.length} linhas`);
console.log(`  de lojas fora do cluster atual: ${staleLojaIds.length}`);
console.log(`  de produtos sem cluster nenhum: ${orphanIds.length}`);
console.log(`  a manter: ${prices.length - staleLojaIds.length - orphanIds.length}`);

if (!APPLY) {
  console.log("\nDRY-RUN. Nada foi apagado. Corre com --apply para aplicar.");
  process.exit(0);
}

// --stale-only: so o caso inequivoco (preco de uma loja que nao esta no cluster
// do produto). Os precos de produtos sem cluster nenhum ficam - apaga-los
// deixava esses produtos na app sem preco nenhum, o que e pior do que um preco
// antigo; esses produtos tem de ser tratados em conjunto (apagar o produto, nao
// so o preco).
const STALE_ONLY = process.argv.includes("--stale-only");
const toDelete = STALE_ONLY ? staleLojaIds : [...staleLojaIds, ...orphanIds];
const CHUNK = 200;
let deleted = 0;
for (let i = 0; i < toDelete.length; i += CHUNK) {
  const chunk = toDelete.slice(i, i + CHUNK);
  const { error } = await supabase.from("matched_prices").delete().in("id", chunk);
  if (error) throw error;
  deleted += chunk.length;
  if (deleted % 2000 === 0 || deleted === toDelete.length) console.log(`... ${deleted}/${toDelete.length}`);
}
console.log(`\n=== FEITO === ${deleted} linhas de preco obsoletas removidas.`);

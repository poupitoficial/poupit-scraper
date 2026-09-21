// Funde as linhas duplicadas de matched_products deixadas pelo pipeline antigo
// (antes do clustering de scripts/insertMatchesAll.mjs).
//
// O pipeline antigo identificava um matched_product por (name, brand) usando
// sempre o nome do lado "a" do par a ser processado. Como o Continente era o
// lado "a" em todos os pares onde aparece, e o Pingo Doce nos pares sem
// Continente, o MESMO produto real ficou em duas linhas com nomes diferentes
// ("Óleo Alimentar Fula" pelo lado do Continente, "Óleo Alimentar" pelo lado
// do Pingo Doce). 2354 das 5722 linhas nao tem cluster associado
// (matched_product_sources vazio) - sao estas sobras.
//
// Como se identifica um duplicado com certeza (nao por semelhanca de nome):
// o nome+marca de uma linha antiga foi copiado verbatim do catalogo de uma
// loja, por isso procura-se esse nome+marca nos catalogos exportados, e ve-se
// se o URL desse produto de loja ja pertence a um cluster
// (matched_product_sources). Se pertence, a linha antiga e o mesmo produto que
// a linha do cluster - por construcao, nao por heuristica.
//
// Seguranca:
//  - so funde quando o nome+marca aponta para EXATAMENTE um cluster (se
//    apontar para 2+, fica de fora);
//  - so apaga quando o cluster ja cobre todas as lojas que a linha antiga
//    cobria (nunca reduz comparacoes de preco);
//  - passa a imagem ja migrada para o Storage para a linha do cluster, se a
//    linha antiga tiver uma e a do cluster nao;
//  - dry-run por omissao. So escreve com --apply.
//
// Pre-requisitos: catalogos exportados frescos (scripts/matchAll.mjs) e
// scripts/insertMatchesAll.mjs ja corrido (para matched_product_sources
// existir e estar preenchido).
import fs from "node:fs";
import "dotenv/config";
import { supabase } from "./src/supabase.js";

const APPLY = process.argv.includes("--apply");

const SOURCES = {
  continente: ["continente_products_full.json", "continente"],
  "pingo-doce": ["pd_products_full.json", "pingo_doce"],
  lidl: ["lidl_products_full.json", "lidl"],
  auchan: ["auchan_products_full.json", "auchan"],
  aldi: ["aldi_products_full.json", "aldi"],
};

const STORAGE_IMAGE_MARKER = "/storage/v1/object/public/product-images/";

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

const norm = (s) => (s || "").trim().toLowerCase();
const nameKey = (name, brand) => `${norm(name)}|${norm(brand)}`;

const catalogIndex = new Map(); // nome+marca -> [{loja, url}]
for (const [file, loja] of Object.values(SOURCES)) {
  if (!fs.existsSync(file)) {
    console.error(`FALTA o catalogo ${file} - corre scripts/matchAll.mjs primeiro.`);
    process.exit(1);
  }
  for (const p of JSON.parse(fs.readFileSync(file, "utf-8"))) {
    const k = nameKey(p.name, p.brand);
    if (!catalogIndex.has(k)) catalogIndex.set(k, []);
    catalogIndex.get(k).push({ loja, url: p.url });
  }
}

const products = await fetchAll("matched_products", "id, name, brand, image_url");
const sources = await fetchAll("matched_product_sources", "product_id, loja, url");
const prices = await fetchAll("matched_prices", "product_id, loja");

const backed = new Set(sources.map((s) => s.product_id));
const clusterByNode = new Map(sources.map((s) => [`${s.loja}::${s.url}`, s.product_id]));
const productById = new Map(products.map((p) => [p.id, p]));

const lojasByProduct = new Map();
for (const r of prices) {
  if (!lojasByProduct.has(r.product_id)) lojasByProduct.set(r.product_id, new Set());
  lojasByProduct.get(r.product_id).add(r.loja);
}

const orphans = products.filter((p) => !backed.has(p.id));
console.log(`${products.length} matched_products | ${products.length - orphans.length} com cluster | ${orphans.length} sobras do pipeline antigo`);

const toMerge = [];
let ambiguous = 0;
let noLink = 0;
let wouldLoseCoverage = 0;

for (const o of orphans) {
  const targets = new Set();
  for (const e of catalogIndex.get(nameKey(o.name, o.brand)) || []) {
    const pid = clusterByNode.get(`${e.loja}::${e.url}`);
    if (pid && pid !== o.id) targets.add(pid);
  }
  if (targets.size === 0) {
    noLink++;
    continue;
  }
  if (targets.size > 1) {
    ambiguous++;
    continue;
  }
  const targetId = [...targets][0];
  const orphanLojas = lojasByProduct.get(o.id) || new Set();
  const targetLojas = lojasByProduct.get(targetId) || new Set();
  const missing = [...orphanLojas].filter((l) => !targetLojas.has(l));
  if (missing.length) {
    wouldLoseCoverage++;
    console.log(`MANTIDO (cluster nao cobre ${missing.join("/")}): ${o.brand} - ${o.name}`);
    continue;
  }
  toMerge.push({ orphan: o, targetId });
}

console.log(`\nA fundir: ${toMerge.length}`);
console.log(`Ambiguos (apontam para 2+ clusters), mantidos: ${ambiguous}`);
console.log(`Sem ligacao a nenhum cluster, mantidos: ${noLink}`);
console.log(`Manter por cobrirem uma loja que o cluster nao cobre: ${wouldLoseCoverage}`);

if (!APPLY) {
  console.log("\n--- amostra de 15 ---");
  for (const m of toMerge.slice(0, 15)) {
    const t = productById.get(m.targetId);
    console.log(`  ${m.orphan.brand} - ${m.orphan.name}`);
    console.log(`    -> ${t?.brand} - ${t?.name}`);
  }
  console.log("\nDRY-RUN. Nada foi escrito. Corre com --apply para aplicar.");
  process.exit(0);
}

let imagesKept = 0;
let deleted = 0;
const CHUNK = 50;

for (let i = 0; i < toMerge.length; i += CHUNK) {
  const chunk = toMerge.slice(i, i + CHUNK);

  // imagem ja no Storage nao se perde: passa para a linha do cluster se ela
  // ainda estiver com um hotlink da loja
  for (const { orphan, targetId } of chunk) {
    const target = productById.get(targetId);
    const orphanInStorage = orphan.image_url?.includes(STORAGE_IMAGE_MARKER);
    const targetInStorage = target?.image_url?.includes(STORAGE_IMAGE_MARKER);
    if (orphanInStorage && !targetInStorage) {
      const { error } = await supabase.from("matched_products").update({ image_url: orphan.image_url }).eq("id", targetId);
      if (error) throw error;
      imagesKept++;
    }
  }

  // matched_prices desaparece por cascade (ver supabase/matched_schema.sql) -
  // sao precos duplicados de um produto que o cluster ja cobre.
  const ids = chunk.map((m) => m.orphan.id);
  const { error } = await supabase.from("matched_products").delete().in("id", ids);
  if (error) throw error;
  deleted += ids.length;
  console.log(`... ${deleted}/${toMerge.length} linhas antigas removidas`);
}

console.log(`\n=== FEITO ===`);
console.log(`Linhas duplicadas removidas: ${deleted} | imagens do Storage preservadas: ${imagesKept}`);

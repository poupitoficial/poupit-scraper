// Revisao manual interativa da fila de baixa confianca (matched_products_review).
//
// Uso:
//   node scripts/reviewMatches.mjs                so as entradas pendentes
//   node scripts/reviewMatches.mjs --suspeitos     so as classificadas como suspeitas (preco ou quantidade)
//   node scripts/reviewMatches.mjs --provaveis     so as classificadas como PROVAVEL MATCH
//   node scripts/reviewMatches.mjs --loja=aldi     so pares que envolvem esta loja
//   node scripts/reviewMatches.mjs --resumo        so mostra a contagem por classificacao, nao entra no loop interativo
//   (flags combinam-se, ex. --suspeitos --loja=aldi)
//
// Para cada par mostra nome/marca/preco/preco-por-unidade/quantidade/URL dos
// dois lados, uma classificacao automatica de suspeita (so contexto, nao
// decide por ti), e pede uma decisao por teclado:
//   [s] confirmar - cria/atualiza a linha em matched_products com
//       confidence='manual' (distingue de 'high', que e automatico) e grava
//       o preco de cada loja em matched_prices.
//   [n] rejeitar - marca status='rejected' em matched_products_review, nao
//       volta a aparecer.
//   [p] pular - deixa como 'pending', decide-se noutra sessao.
//   [q] sair - para o loop, guarda o que ja foi decidido (cada decisao e
//       gravada de imediato, nao ha nada para perder ao sair).
//
// Precisa de:
//   supabase/013_matched_products_confidence_manual.sql
//   supabase/014_matched_products_review_details.sql
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";
import { priceChanged } from "../src/priceHistory.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim().toLowerCase())));
}

function parseArgs(argv) {
  const args = { suspeitos: false, provaveis: false, resumo: false, loja: null };
  for (const arg of argv) {
    if (arg === "--suspeitos") args.suspeitos = true;
    else if (arg === "--provaveis") args.provaveis = true;
    else if (arg === "--resumo") args.resumo = true;
    else if (arg.startsWith("--loja=")) args.loja = arg.slice("--loja=".length);
  }
  return args;
}

export async function fetchPending() {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await supabase
      .from("matched_products_review")
      .select("*")
      .eq("status", "pending")
      .order("loja_a")
      .order("loja_b")
      .order("name_a")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

const PRICE_SUSPECT_THRESHOLD = 0.5;
const PRICE_PROBABLE_THRESHOLD = 0.15;
const QTY_TOLERANCE = 0.05;

// So um contexto para decidir mais rapido - nunca decide por conta propria.
// Prioridade: preco/unidade muito diferente e o sinal mais forte de produto
// diferente (caso real: bolachas Gullon 11.77 vs 5.86 €/kg, mesmo peso e
// marca); a seguir quantidade diferente; só depois "provavel match" quando o
// preco/unidade bate certo.
export function classify(entry) {
  const ppuA = entry.price_per_unit_a;
  const ppuB = entry.price_per_unit_b;
  const hasComparablePrice = ppuA != null && ppuB != null && ppuA > 0 && ppuB > 0;
  const priceRatio = hasComparablePrice ? Math.max(ppuA, ppuB) / Math.min(ppuA, ppuB) - 1 : null;

  const unitA = entry.quantity_unit_a;
  const unitB = entry.quantity_unit_b;
  const qtyA = entry.quantity_a;
  const qtyB = entry.quantity_b;
  const bothRealQty = qtyA != null && qtyB != null && unitA && unitB && unitA !== "proxy" && unitB !== "proxy";
  const quantityDiffers = bothRealQty
    ? unitA !== unitB || Math.abs(qtyA - qtyB) / Math.max(qtyA, qtyB) > QTY_TOLERANCE
    : false;

  if (priceRatio != null && priceRatio > PRICE_SUSPECT_THRESHOLD) {
    return { label: "SUSPEITO: preco/unidade muito diferente", priceRatio, quantityDiffers };
  }
  if (quantityDiffers) {
    return { label: "SUSPEITO: quantidade diferente", priceRatio, quantityDiffers };
  }
  if (priceRatio != null && priceRatio <= PRICE_PROBABLE_THRESHOLD) {
    return { label: "PROVAVEL MATCH", priceRatio, quantityDiffers };
  }
  return { label: "sem dados suficientes para classificar", priceRatio, quantityDiffers };
}

async function findExistingMatchedProduct(name, brand) {
  const { data, error } = await supabase
    .from("matched_products")
    .select("id, confidence")
    .eq("name", name)
    .eq("brand", brand)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertPrice(productId, loja, preco) {
  const { data: latest } = await supabase
    .from("matched_prices")
    .select("preco")
    .eq("product_id", productId)
    .eq("loja", loja)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!priceChanged(latest?.preco, preco)) return false;
  const { error } = await supabase.from("matched_prices").insert({
    product_id: productId,
    loja,
    preco,
    data: new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return true;
}

export async function approve(entry) {
  let productId;
  const existing = await findExistingMatchedProduct(entry.name_a, entry.brand);
  if (existing) {
    productId = existing.id;
    // nao faz downgrade de 'high' para 'manual' - so marca manual quando a
    // linha nasce desta aprovacao.
  } else {
    const { data: created, error } = await supabase
      .from("matched_products")
      .insert({
        name: entry.name_a,
        brand: entry.brand,
        category: entry.category,
        quantity: entry.quantity,
        quantity_unit: entry.quantity_unit,
        image_url: entry.image_url,
        confidence: "manual",
        match_score: entry.match_score,
      })
      .select("id")
      .single();
    if (error) throw error;
    productId = created.id;
  }

  await upsertPrice(productId, entry.loja_a, entry.price_a);
  await upsertPrice(productId, entry.loja_b, entry.price_b);

  const { error: reviewError } = await supabase
    .from("matched_products_review")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", entry.id);
  if (reviewError) throw reviewError;
}

export async function reject(entry) {
  const { error } = await supabase
    .from("matched_products_review")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", entry.id);
  if (error) throw error;
}

function fmtPpu(value, unit) {
  if (value == null) return "?";
  const label = unit === "volume" ? "€/L" : unit === "weight" ? "€/kg" : "€/un";
  return `${Number(value).toFixed(2)}${label}`;
}

function printEntry(entry, index, total, info) {
  console.log(`\n[${index + 1}/${total}] score=${Number(entry.match_score).toFixed(3)} categoria=${entry.category ?? "?"} -> ${info.label}`);
  console.log(`  ${entry.loja_a.padEnd(12)} "${entry.name_a}"`);
  console.log(`    preco: ${entry.price_a}€  |  preco/unidade: ${fmtPpu(entry.price_per_unit_a, entry.quantity_unit_a)}  |  qtd: ${entry.quantity_a ?? "?"} (${entry.quantity_unit_a ?? "?"})`);
  if (entry.url_a) console.log(`    ${entry.url_a}`);
  console.log(`  ${entry.loja_b.padEnd(12)} "${entry.name_b}"`);
  console.log(`    preco: ${entry.price_b}€  |  preco/unidade: ${fmtPpu(entry.price_per_unit_b, entry.quantity_unit_b)}  |  qtd: ${entry.quantity_b ?? "?"} (${entry.quantity_unit_b ?? "?"})`);
  if (entry.url_b) console.log(`    ${entry.url_b}`);
  console.log(`  marca: ${entry.brand ?? "-"}`);
  if (info.priceRatio != null) console.log(`  diferenca preco/unidade: ${(info.priceRatio * 100).toFixed(0)}%`);
}

function applyFilters(pending, args) {
  return pending.filter((entry) => {
    if (args.loja && entry.loja_a !== args.loja && entry.loja_b !== args.loja) return false;
    const info = classify(entry);
    if (args.suspeitos && !info.label.startsWith("SUSPEITO")) return false;
    if (args.provaveis && info.label !== "PROVAVEL MATCH") return false;
    return true;
  });
}

function printSummary(pending) {
  const counts = {
    "SUSPEITO: preco/unidade muito diferente": 0,
    "SUSPEITO: quantidade diferente": 0,
    "PROVAVEL MATCH": 0,
    "sem dados suficientes para classificar": 0,
  };
  for (const entry of pending) counts[classify(entry).label]++;
  console.log(`\n--- Classificacao das ${pending.length} entradas pendentes ---`);
  for (const [label, count] of Object.entries(counts)) {
    console.log(`${label}: ${count} (${((count / pending.length) * 100).toFixed(1)}%)`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allPending = await fetchPending();

  if (args.resumo) {
    printSummary(allPending);
    return;
  }

  const filtered = applyFilters(allPending, args);
  console.log(`${allPending.length} pendentes no total, ${filtered.length} depois dos filtros aplicados.\n`);
  if (!filtered.length) return;

  const summary = { approved: 0, rejected: 0, skipped: 0 };
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    printEntry(entry, i, filtered.length, classify(entry));
    const answer = await ask("  [s]im / [n]ao / [p]ular / [q]uit: ");
    if (answer === "s") {
      await approve(entry);
      summary.approved++;
      console.log("  -> confirmado, gravado em matched_products (confidence=manual).");
    } else if (answer === "n") {
      await reject(entry);
      summary.rejected++;
      console.log("  -> rejeitado.");
    } else if (answer === "q") {
      console.log("\na sair - progresso ja gravado a cada decisao.");
      break;
    } else {
      summary.skipped++;
      console.log("  -> saltado (fica pending).");
    }
  }

  console.log("\n--- Resumo desta sessao ---");
  console.log(`Confirmados: ${summary.approved}`);
  console.log(`Rejeitados: ${summary.rejected}`);
  console.log(`Saltados: ${summary.skipped}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((err) => {
      console.error("Falha fatal:", err);
      process.exitCode = 1;
    })
    .finally(() => rl.close());
}

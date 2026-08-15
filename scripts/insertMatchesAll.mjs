// Insere/atualiza os matches de marca de fabricante (nao marca propria, ver
// matchLib.mjs) de todos os pares em matched_products/matched_prices.
// Idempotente por (name, brand): se ja existe uma linha com esse par, so
// atualiza (subcategory/category/image_url/confidence/match_score) e acrescenta
// um ponto de preco novo; nao cria duplicado. Precisa de:
//   supabase/003_matched_prices_add_lidl.sql
//   supabase/004_matched_review_queue_and_confidence.sql
//   supabase/007_matched_products_subcategory.sql
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const LOJA_NAME = { continente: "continente", "pingo-doce": "pingo_doce", lidl: "lidl", auchan: "auchan" };

const PAIRS = [
  ["continente", "pingo-doce"],
  ["continente", "lidl"],
  ["continente", "auchan"],
  ["pingo-doce", "lidl"],
  ["pingo-doce", "auchan"],
  ["lidl", "auchan"],
];

// Abaixo deste score, um match nao vai para matched_products (visivel na app)
// mas para matched_products_review (revisao manual). Ver
// supabase/004_matched_review_queue_and_confidence.sql - motivado por um bug
// real: formulas infantis NAN de estagios diferentes emparelhadas entre si com
// score 0.45-0.571 (peso igual, digito do estagio ignorado no nome).
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

const today = new Date().toISOString().slice(0, 10);
const INSERT_CHUNK = 500;
const CONCURRENT_UPDATES = 20;

const key = (name, brand) => `${name.trim().toLowerCase()}|${(brand || "").trim().toLowerCase()}`;

async function fetchAllExisting() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map();
  while (true) {
    const { data, error } = await supabase
      .from("matched_products")
      .select("id, name, brand")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) map.set(key(row.name, row.brand), row.id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

async function fetchAllExistingReview() {
  const pageSize = 1000;
  let from = 0;
  const set = new Set();
  while (true) {
    const { data, error } = await supabase
      .from("matched_products_review")
      .select("loja_a, loja_b, name_a, name_b")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) set.add(reviewKey(row.loja_a, row.loja_b, row.name_a, row.name_b));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return set;
}

const reviewKey = (lojaA, lojaB, nameA, nameB) =>
  `${lojaA}|${lojaB}|${nameA.trim().toLowerCase()}|${nameB.trim().toLowerCase()}`;

console.log("--- a carregar matched_products existentes (para nao duplicar) ---");
const existingByKey = await fetchAllExisting();
console.log(`${existingByKey.size} produtos existentes carregados.`);

console.log("--- a carregar matched_products_review existentes (para nao duplicar) ---");
const existingReviewKeys = await fetchAllExistingReview();
console.log(`${existingReviewKeys.size} entradas de revisao existentes carregadas.\n`);

let totalInserted = 0;
let totalUpdated = 0;
let totalReview = 0;

for (const [labelA, labelB] of PAIRS) {
  const file = path.join(root, "analysis", `matches_${labelA}_${labelB}.json`);
  if (!fs.existsSync(file)) {
    console.log(`(sem ficheiro ${file}, salta)`);
    continue;
  }
  const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
  const brandMatches = matches.filter((m) => !m.ownBrand);
  const highConfidence = brandMatches.filter((m) => m.score >= HIGH_CONFIDENCE_THRESHOLD);
  const lowConfidence = brandMatches.filter((m) => m.score < HIGH_CONFIDENCE_THRESHOLD);

  console.log(
    `--- ${labelA} x ${labelB}: ${brandMatches.length} matches de marca fabricante ` +
      `(${highConfidence.length} alta confianca, ${lowConfidence.length} para revisao) ---`
  );

  const toInsert = [];
  const toUpdate = [];
  for (const m of highConfidence) {
    const name = m.a.name;
    const brand = m.a.brand || m.b.brand || "";
    const existingId = existingByKey.get(key(name, brand));
    const category = m.a.category || m.b.category || null;
    const subcategory = m.a.subcategory || m.b.subcategory || null;
    const qty = m.a.qty || m.b.qty;
    const record = {
      name,
      brand,
      category,
      subcategory,
      quantity: qty?.qty ?? null,
      quantity_unit: qty?.kind ?? null,
      image_url: m.a.imageUrl || m.b.imageUrl || null,
      confidence: "high",
      match_score: m.score,
    };
    if (existingId) toUpdate.push({ id: existingId, record, priceA: m.a.price, priceB: m.b.price });
    else toInsert.push({ record, priceA: m.a.price, priceB: m.b.price });
  }

  // --- inserts novos ---
  let inserted = 0;
  let blockedByConstraint = false;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    const { data: insertedProducts, error: productError } = await supabase
      .from("matched_products")
      .insert(chunk.map((r) => r.record))
      .select("id");
    if (productError) {
      console.error(`ERRO a inserir matched_products (${labelA} x ${labelB}):`, productError.message);
      break;
    }
    const priceRows = insertedProducts.flatMap((p, idx) => [
      { product_id: p.id, loja: LOJA_NAME[labelA], preco: chunk[idx].priceA, data: today },
      { product_id: p.id, loja: LOJA_NAME[labelB], preco: chunk[idx].priceB, data: today },
    ]);
    const { error: priceError } = await supabase.from("matched_prices").insert(priceRows);
    if (priceError) {
      if (priceError.message.includes("matched_prices_loja_check")) {
        console.error(
          `BLOQUEADO: a constraint matched_prices ainda nao aceita "${LOJA_NAME[labelA]}"/"${LOJA_NAME[labelB]}". ` +
            `Corre supabase/003_matched_prices_add_lidl.sql no SQL editor e volta a correr este script.`
        );
        blockedByConstraint = true;
        await supabase.from("matched_products").delete().in("id", insertedProducts.map((p) => p.id));
        break;
      }
      console.error(`ERRO a inserir matched_prices (${labelA} x ${labelB}):`, priceError.message);
      break;
    }
    inserted += insertedProducts.length;
    // regista as chaves recem-inseridas para os proximos pares nao as duplicarem
    insertedProducts.forEach((p, idx) => existingByKey.set(key(chunk[idx].record.name, chunk[idx].record.brand), p.id));
  }

  // --- updates dos ja existentes (preenche subcategory/confidence e regista preco novo) ---
  let updated = 0;
  let updateBlocked = false;
  for (let i = 0; i < toUpdate.length; i += CONCURRENT_UPDATES) {
    const chunk = toUpdate.slice(i, i + CONCURRENT_UPDATES);
    const results = await Promise.all(
      chunk.map(async ({ id, record, priceA, priceB }) => {
        const { error: updateError } = await supabase.from("matched_products").update(record).eq("id", id);
        if (updateError) return { ok: false, error: updateError };
        const { error: priceError } = await supabase.from("matched_prices").insert([
          { product_id: id, loja: LOJA_NAME[labelA], preco: priceA, data: today },
          { product_id: id, loja: LOJA_NAME[labelB], preco: priceB, data: today },
        ]);
        if (priceError) return { ok: false, error: priceError };
        return { ok: true };
      })
    );
    for (const r of results) {
      if (r.ok) updated++;
      else if (r.error?.message.includes("matched_prices_loja_check")) updateBlocked = true;
      else console.error(`ERRO a atualizar match existente (${labelA} x ${labelB}):`, r.error?.message);
    }
    if (updateBlocked) break;
  }

  console.log(`${labelA} x ${labelB}: ${inserted} novos, ${updated} atualizados (subcategory/confidence + preco novo).`);
  if (blockedByConstraint || updateBlocked) console.log(`${labelA} x ${labelB}: PENDENTE de migration (loja bloqueada).`);
  totalInserted += inserted;
  totalUpdated += updated;

  // --- baixa confianca -> fila de revisao (so as que ainda nao la estao) ---
  const newLowConfidence = lowConfidence.filter(
    (m) => !existingReviewKeys.has(reviewKey(LOJA_NAME[labelA], LOJA_NAME[labelB], m.a.name, m.b.name))
  );
  const skippedReview = lowConfidence.length - newLowConfidence.length;
  if (newLowConfidence.length) {
    const reviewRows = newLowConfidence.map((m) => {
      const qty = m.a.qty || m.b.qty;
      return {
        loja_a: LOJA_NAME[labelA],
        loja_b: LOJA_NAME[labelB],
        match_score: m.score,
        name_a: m.a.name,
        name_b: m.b.name,
        brand: m.a.brand || m.b.brand || null,
        category: m.a.category || m.b.category || null,
        quantity: qty?.qty ?? null,
        quantity_unit: qty?.kind ?? null,
        price_a: m.a.price,
        price_b: m.b.price,
        image_url: m.a.imageUrl || m.b.imageUrl || null,
      };
    });
    const { error: reviewError } = await supabase.from("matched_products_review").insert(reviewRows);
    if (reviewError) {
      console.error(
        `AVISO: nao consegui gravar ${reviewRows.length} matches de baixa confianca em matched_products_review: ` +
          `${reviewError.message}. Precisa de supabase/004_matched_review_queue_and_confidence.sql.`
      );
    } else {
      console.log(
        `${labelA} x ${labelB}: ${reviewRows.length} matches de baixa confianca novos em matched_products_review` +
          (skippedReview ? ` (${skippedReview} ja existiam, saltados)` : "") + "."
      );
      totalReview += reviewRows.length;
      for (const m of newLowConfidence) existingReviewKeys.add(reviewKey(LOJA_NAME[labelA], LOJA_NAME[labelB], m.a.name, m.b.name));
    }
  } else if (skippedReview) {
    console.log(`${labelA} x ${labelB}: ${skippedReview} matches de baixa confianca ja existiam, nada novo.`);
  }
  console.log("");
}

console.log("=== TOTAL ===");
console.log(`Inseridos: ${totalInserted} | Atualizados: ${totalUpdated} | Para revisao: ${totalReview}`);

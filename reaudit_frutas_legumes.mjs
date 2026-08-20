// Reaudita os matched_products (category=frutas_legumes, confidence=high ou
// manual) ja aprovados em sessoes anteriores contra o criterio novo de
// preco/unidade (<=15%). matched_products nao guarda o nome/marca de cada
// loja separadamente (so um nome canonico), por isso procura o par
// correspondente nos ficheiros de matches atuais (analysis/matches_*.json,
// que tem a.name/b.name/a.pricePerUnit/b.pricePerUnit de cada loja) para
// obter o preco/unidade real de cada lado.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "./src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const PAIR_FILES = [
  "continente_pingo-doce", "continente_lidl", "continente_auchan",
  "pingo-doce_lidl", "pingo-doce_auchan", "lidl_auchan",
  "continente_aldi", "pingo-doce_aldi", "lidl_aldi", "auchan_aldi",
];

const PPU_TOLERANCE = 0.15;

function normKey(name, brand) {
  return `${name.trim().toLowerCase()}|${(brand || "").trim().toLowerCase()}`;
}

async function main() {
  // indice: normKey(name,brand) -> {ppu, otherSide:{name,ppu,pair}}
  const byKey = new Map();
  for (const pair of PAIR_FILES) {
    const file = path.join(root, "analysis", `matches_${pair}.json`);
    if (!fs.existsSync(file)) continue;
    const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const m of matches) {
      const keyA = normKey(m.a.name, m.a.brand);
      const keyB = normKey(m.b.name, m.b.brand);
      if (!byKey.has(keyA)) byKey.set(keyA, []);
      byKey.get(keyA).push({ pair, side: "a", ppu: m.a.pricePerUnit, otherName: m.b.name, otherPpu: m.b.pricePerUnit, score: m.score });
      if (!byKey.has(keyB)) byKey.set(keyB, []);
      byKey.get(keyB).push({ pair, side: "b", ppu: m.b.pricePerUnit, otherName: m.a.name, otherPpu: m.a.pricePerUnit, score: m.score });
    }
  }

  const { data: approved, error } = await supabase
    .from("matched_products")
    .select("id, name, brand, confidence, match_score")
    .eq("category", "frutas_legumes")
    .in("confidence", ["high", "manual"]);
  if (error) throw error;

  console.log(`${approved.length} matches frutas_legumes aprovados a reauditar.`);

  const results = { auditedOk: 0, failedAuto: [], failedManual: [], notFound: 0 };

  for (const row of approved) {
    const key = normKey(row.name, row.brand);
    const candidates = byKey.get(key);
    if (!candidates || !candidates.length) {
      results.notFound++;
      continue;
    }
    // usa a melhor candidata (maior score) encontrada para este produto
    const best = candidates.sort((x, y) => y.score - x.score)[0];
    if (best.ppu == null || best.otherPpu == null || best.ppu <= 0 || best.otherPpu <= 0) {
      // sem dados suficientes para reauditar - nao mexe, conta como ok (nao ha como provar que falha)
      results.auditedOk++;
      continue;
    }
    const ratio = Math.max(best.ppu, best.otherPpu) / Math.min(best.ppu, best.otherPpu) - 1;
    if (ratio <= PPU_TOLERANCE) {
      results.auditedOk++;
    } else {
      const entry = { id: row.id, name: row.name, brand: row.brand, ppuThis: best.ppu, otherName: best.otherName, ppuOther: best.otherPpu, ratio };
      if (row.confidence === "manual") results.failedManual.push(entry);
      else results.failedAuto.push(entry);
    }
  }

  console.log(`\n--- Resumo da reauditoria ---`);
  console.log(`Reauditados sem problema (ppu bate ou sem dados para provar o contrario): ${results.auditedOk}`);
  console.log(`Nao encontrados nos ficheiros de matches atuais (produto pode ter mudado/desaparecido): ${results.notFound}`);
  console.log(`Falham o criterio novo (automaticos): ${results.failedAuto.length}`);
  console.log(`Falham o criterio novo (aprovados manualmente - NAO MEXIDOS): ${results.failedManual.length}`);

  console.log(`\n--- Lista dos automaticos que falham (movidos para revisao) ---`);
  for (const f of results.failedAuto) {
    console.log(`  "${f.name}" (${f.brand}) ppu=${f.ppuThis} <-> "${f.otherName}" ppu=${f.ppuOther} (${(f.ratio * 100).toFixed(0)}% diferenca)`);
  }
  if (results.failedManual.length) {
    console.log(`\n--- ATENCAO: aprovados manualmente que falhariam o criterio novo (NAO tocados) ---`);
    for (const f of results.failedManual) {
      console.log(`  "${f.name}" (${f.brand}) ppu=${f.ppuThis} <-> "${f.otherName}" ppu=${f.ppuOther} (${(f.ratio * 100).toFixed(0)}% diferenca)`);
    }
  }

  if (results.failedAuto.length) {
    console.log(`\n--- a mover ${results.failedAuto.length} para matched_products_review (status=reaudit_pending) ---`);
    for (const f of results.failedAuto) {
      const { data: mp } = await supabase.from("matched_products").select("*").eq("id", f.id).single();
      const { data: prices } = await supabase.from("matched_prices").select("loja, preco").eq("product_id", f.id);
      const priceA = prices?.[0]?.preco ?? null;
      const priceB = prices?.[1]?.preco ?? null;
      const lojaA = prices?.[0]?.loja ?? "desconhecida";
      const lojaB = prices?.[1]?.loja ?? "desconhecida";

      const { error: insError } = await supabase.from("matched_products_review").insert({
        loja_a: lojaA,
        loja_b: lojaB,
        match_score: mp.match_score ?? 0,
        name_a: mp.name,
        name_b: f.otherName,
        brand: mp.brand,
        category: mp.category,
        quantity: mp.quantity,
        quantity_unit: mp.quantity_unit,
        price_a: priceA ?? 0,
        price_b: priceB ?? 0,
        price_per_unit_a: f.ppuThis,
        price_per_unit_b: f.ppuOther,
        image_url: mp.image_url,
        status: "reaudit_pending",
      });
      if (insError) console.error(`  erro ao mover "${f.name}": ${insError.message}`);
      else {
        const { error: delError } = await supabase.from("matched_prices").delete().eq("product_id", f.id);
        if (delError) console.error(`  erro ao apagar precos de "${f.name}": ${delError.message}`);
        const { error: delMpError } = await supabase.from("matched_products").delete().eq("id", f.id);
        if (delMpError) console.error(`  erro ao apagar matched_products "${f.name}": ${delMpError.message}`);
      }
    }
    console.log("Concluido.");
  }
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

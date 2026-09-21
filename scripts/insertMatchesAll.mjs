// Insere/atualiza os matches de marca de fabricante (nao marca propria, ver
// matchLib.mjs) de todos os pares em matched_products/matched_prices.
//
// Antes, um matched_product existente so era reconhecido por (name, brand) em
// minusculas, usando sempre o nome do lado "a" do par a ser processado. Como
// o mesmo produto real tem grafias ligeiramente diferentes consoante a loja,
// e cada par e processado de forma independente, o mesmo produto real
// fragmentava-se em varias linhas (uma por combinacao de lojas cujo par
// coincidiu no anchor certo) - maximo observado: 3 lojas num so produto, 97%
// dos produtos so com 2, apesar de 10 pares comparados.
//
// Agora usa-se um union-find sobre TODOS os pares: cada produto de uma loja e
// um no (identificado por loja+url, estavel entre corridas), e um match de
// alta confianca entre dois lados une os dois nos no mesmo cluster - mesmo
// que a ligacao passe por pares diferentes (ex.: Continente~PingoDoce e
// PingoDoce~Lidl fundem-se no mesmo cluster Continente+PingoDoce+Lidl mesmo
// sem existir um par Continente~Lidl direto). Cada cluster vira UMA linha em
// matched_products com um preco por loja presente, em vez de uma linha por
// par. supabase/022_matched_product_sources.sql regista que (loja,url) origina
// cada matched_product, para reconhecer o mesmo cluster em corridas futuras
// mesmo que a loja "ancora" mude - PRECISA de estar corrida antes deste script.
//
// Salvaguarda: se um cluster contiver dois produtos da MESMA loja (sinal de
// uma cadeia de matches incorreta a fundir dois produtos reais diferentes),
// esse cluster e todo excluido desta corrida (fica como estava, nada e
// escrito) em vez de arriscar uma fusao errada - ver CONFLITOS abaixo.
//
// Precisa de:
//   supabase/003_matched_prices_add_lidl.sql
//   supabase/004_matched_review_queue_and_confidence.sql
//   supabase/007_matched_products_subcategory.sql
//   supabase/008_matched_prices_add_auchan.sql
//   supabase/012_matched_prices_add_aldi.sql
//   supabase/022_matched_product_sources.sql
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";
import { isSafeFrutasLegumesOwnBrand } from "./matchLib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const LOJA_NAME = { continente: "continente", "pingo-doce": "pingo_doce", lidl: "lidl", auchan: "auchan", aldi: "aldi" };
const STORE_PRIORITY = ["continente", "pingo-doce", "auchan", "lidl", "aldi"];

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

// Abaixo deste score, um match nao vai para matched_products (visivel na app)
// mas para matched_products_review (revisao manual). Ver
// supabase/004_matched_review_queue_and_confidence.sql - motivado por um bug
// real: formulas infantis NAN de estagios diferentes emparelhadas entre si com
// score 0.45-0.571 (peso igual, digito do estagio ignorado no nome).
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

const today = new Date().toISOString().slice(0, 10);
const CONCURRENT_UPDATES = 20;

const key = (name, brand) => `${name.trim().toLowerCase()}|${(brand || "").trim().toLowerCase()}`;
const nodeId = (store, url) => `${store}::${url}`;

const STORAGE_IMAGE_MARKER = "/storage/v1/object/public/product-images/";

// Union-find com uma restricao: um cluster nunca pode conter dois produtos da
// MESMA loja. Sem isso, variantes proximas da mesma marca ligam-se em cadeia
// atraves de um match fraco e fundem dois produtos reais diferentes (visto ao
// vivo: "Vinagre de Vinho Branco Gallo" e "Vinagre de Vinho Branco Chardonnay
// Gallo", ambos do Continente, acabavam no mesmo cluster via o lado do Auchan).
// Os edges sao aplicados por score decrescente, por isso a ligacao mais forte
// ganha e so a mais fraca e rejeitada - o cluster parte-se nos dois produtos
// reais em vez de ser todo descartado.
class ConstrainedUnionFind {
  constructor() {
    this.parent = new Map();
    this.stores = new Map(); // root -> Set de lojas no cluster
  }
  add(x, store) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.stores.set(x, new Set([store]));
    }
  }
  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  // devolve false se a uniao juntaria duas lojas repetidas (edge rejeitado)
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;
    const sa = this.stores.get(ra);
    const sb = this.stores.get(rb);
    for (const s of sb) if (sa.has(s)) return false;
    this.parent.set(ra, rb);
    for (const s of sa) sb.add(s);
    this.stores.delete(ra);
    return true;
  }
}

async function fetchAllExisting() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map();
  while (true) {
    const { data, error } = await supabase
      .from("matched_products")
      .select("id, name, brand, image_url, created_at")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) map.set(key(row.name, row.brand), row);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

// (loja,url) -> product_id, para reconhecer clusters ja existentes entre
// corridas mesmo que a loja "ancora" mude. Populado por este proprio script
// (ver supabase/022_matched_product_sources.sql); vazio na primeira corrida
// depois da migration - fetchAllExisting() acima serve de rede de seguranca
// nessa primeira corrida (liga pelo nome/marca que ja existia).
async function fetchAllExistingSources() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map();
  while (true) {
    const { data, error } = await supabase.from("matched_product_sources").select("product_id, loja, url").range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) map.set(`${row.loja}::${row.url}`, row.product_id);
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

// So grava uma linha nova em matched_prices quando o preco muda desde a ultima
// vez, tal como src/priceHistory.js ja faz para o histórico principal do
// scraper - sem isto, cada corrida deste script acrescenta uma linha por
// produto/loja mesmo sem mudanca nenhuma.
function priceChanged(previousPrice, newPrice) {
  if (previousPrice == null) return true;
  return Math.round(previousPrice * 100) !== Math.round(newPrice * 100);
}

async function fetchLatestPrices() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map(); // `${product_id}|${loja}` -> { preco, data }
  while (true) {
    const { data, error } = await supabase
      .from("matched_prices")
      .select("product_id, loja, preco, data")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) {
      const k = `${row.product_id}|${row.loja}`;
      const current = map.get(k);
      if (!current || row.data > current.data) map.set(k, { preco: row.preco, data: row.data });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

console.log("--- a carregar matched_products existentes (para nao duplicar) ---");
const existingByKey = await fetchAllExisting();
console.log(`${existingByKey.size} produtos existentes carregados.`);
// mapa reverso id -> meta, para o merge de duplicados legados (ver processCluster)
const existingByKeyReverse = new Map();
for (const row of existingByKey.values()) existingByKeyReverse.set(row.id, row);

console.log("--- a carregar matched_product_sources existentes ---");
const sourceByNode = await fetchAllExistingSources();
console.log(`${sourceByNode.size} origens (loja,url) ja registadas.`);

console.log("--- a carregar matched_products_review existentes (para nao duplicar) ---");
const existingReviewKeys = await fetchAllExistingReview();
console.log(`${existingReviewKeys.size} entradas de revisao existentes carregadas.\n`);

console.log("--- a carregar ultimos precos de matched_prices (para so gravar quando mudar) ---");
const latestPriceByKey = await fetchLatestPrices();
console.log(`${latestPriceByKey.size} pares produto/loja com preco conhecido.\n`);

let totalPricesSkipped = 0;
let totalReview = 0;

// === FASE 1: recolhe matches de alta confianca de todos os pares (para o
// clustering) e grava os de baixa confianca na fila de revisao (por par,
// sem alteracoes - a fila nao e fundida entre lojas). ===
const uf = new ConstrainedUnionFind();
const nodeData = new Map(); // nodeId -> { store, name, brand, price, pricePerUnit, qty, url, imageUrl, category, subcategory }
const edges = []; // { idA, idB, score }

for (const [labelA, labelB] of PAIRS) {
  const file = path.join(root, "analysis", `matches_${labelA}_${labelB}.json`);
  if (!fs.existsSync(file)) {
    console.log(`(sem ficheiro ${file}, salta)`);
    continue;
  }
  const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
  const brandMatches = matches.filter((m) => !m.ownBrand || m.a.category === "frutas_legumes" || m.b.category === "frutas_legumes");

  function isFrutasLegumesOwnBrandCase(m) {
    return m.ownBrand && (m.a.category === "frutas_legumes" || m.b.category === "frutas_legumes");
  }

  const highConfidence = brandMatches.filter((m) =>
    isFrutasLegumesOwnBrandCase(m) ? isSafeFrutasLegumesOwnBrand(m) : m.score >= HIGH_CONFIDENCE_THRESHOLD
  );
  const lowConfidence = brandMatches.filter((m) =>
    isFrutasLegumesOwnBrandCase(m) ? !isSafeFrutasLegumesOwnBrand(m) : m.score < HIGH_CONFIDENCE_THRESHOLD
  );

  for (const m of highConfidence) {
    const idA = nodeId(labelA, m.a.url);
    const idB = nodeId(labelB, m.b.url);
    nodeData.set(idA, { store: labelA, ...m.a });
    nodeData.set(idB, { store: labelB, ...m.b });
    uf.add(idA, labelA);
    uf.add(idB, labelB);
    edges.push({ idA, idB, score: m.score });
  }

  const newLowConfidence = lowConfidence.filter(
    (m) => !existingReviewKeys.has(reviewKey(LOJA_NAME[labelA], LOJA_NAME[labelB], m.a.name, m.b.name))
  );
  const skippedReview = lowConfidence.length - newLowConfidence.length;
  if (newLowConfidence.length) {
    const withPrice = newLowConfidence.filter((m) => m.a.price != null && m.b.price != null);
    const missingPrice = newLowConfidence.length - withPrice.length;
    const reviewRows = withPrice.map((m) => {
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
      };
    });
    if (missingPrice) console.log(`${labelA} x ${labelB}: ${missingPrice} saltados p/ revisao (preco null num dos lados).`);
    if (reviewRows.length) {
      const { error: reviewError } = await supabase.from("matched_products_review").insert(reviewRows);
      if (reviewError) {
        console.error(`AVISO: nao consegui gravar ${reviewRows.length} matches de baixa confianca (${labelA} x ${labelB}): ${reviewError.message}`);
      } else {
        totalReview += reviewRows.length;
        for (const m of withPrice) existingReviewKeys.add(reviewKey(LOJA_NAME[labelA], LOJA_NAME[labelB], m.a.name, m.b.name));
      }
    }
  } else if (skippedReview) {
    console.log(`${labelA} x ${labelB}: ${skippedReview} matches de baixa confianca ja existiam, nada novo.`);
  }
}

console.log(`\n--- ${nodeData.size} produtos de loja envolvidos em ${edges.length} matches de alta confianca ---`);

// === FASE 2: aplica os edges por score decrescente (o match mais forte manda)
// e agrupa nos por cluster ===
edges.sort((a, b) => b.score - a.score);
const acceptedEdges = [];
let rejectedEdges = 0;
for (const e of edges) {
  if (uf.union(e.idA, e.idB)) acceptedEdges.push(e);
  else rejectedEdges++;
}
if (rejectedEdges) {
  console.log(`${rejectedEdges} matches rejeitados (juntariam dois produtos da mesma loja no mesmo cluster - variantes distintas).`);
}

const clusterByRoot = new Map(); // root -> [nodeId, ...]
for (const id of nodeData.keys()) {
  const r = uf.find(id);
  if (!clusterByRoot.has(r)) clusterByRoot.set(r, []);
  clusterByRoot.get(r).push(id);
}

const minScoreByRoot = new Map();
for (const e of acceptedEdges) {
  const r = uf.find(e.idA);
  minScoreByRoot.set(r, Math.min(minScoreByRoot.get(r) ?? 1, e.score));
}

const clusters = [];
for (const [r, ids] of clusterByRoot.entries()) {
  if (ids.length < 2) continue; // no isolado: todos os seus edges foram rejeitados
  clusters.push({ ids, score: minScoreByRoot.get(r) ?? 1 });
}
console.log(`${clusters.length} clusters para inserir/atualizar.\n`);

// === FASE 3: resolve cada cluster contra o estado existente e escreve ===
let totalInserted = 0;
let totalUpdated = 0;
let totalMerged = 0;
let blockedByConstraint = false;
// linhas de matched_products ja atribuidas a um cluster nesta corrida - impede
// que dois clusters diferentes escrevam por cima da mesma linha
const claimedProductIds = new Set();

function pickField(ids, fieldPicker) {
  for (const store of STORE_PRIORITY) {
    const id = ids.find((i) => nodeData.get(i).store === store);
    if (!id) continue;
    const v = fieldPicker(nodeData.get(id));
    if (v != null && v !== "") return v;
  }
  return null;
}

async function processCluster({ ids, score }) {
  const name = pickField(ids, (n) => n.name);
  const brand = pickField(ids, (n) => n.brand) || "";
  const category = pickField(ids, (n) => n.category);
  const subcategory = pickField(ids, (n) => n.subcategory);
  const qty = pickField(ids, (n) => n.qty);
  const hotlinkImage = pickField(ids, (n) => n.imageUrl);

  // ids existentes encontrados para este cluster: por origem (loja,url) ja
  // registada, e como rede de seguranca, pelo par (name,brand) que o cluster
  // geraria hoje (liga a produtos criados antes desta migration).
  const foundIds = new Set();
  for (const id of ids) {
    const n = nodeData.get(id);
    const src = sourceByNode.get(`${LOJA_NAME[n.store]}::${n.url}`);
    if (src) foundIds.add(src);
  }
  // A rede de seguranca por (name, brand) so vale para produtos criados antes
  // de matched_product_sources existir. Dois clusters diferentes podem gerar o
  // mesmo (name, brand) - ex. duas embalagens da mesma marca cujo nome nao diz
  // o tamanho - e ai o segundo cluster sobrescrevia a linha do primeiro em vez
  // de ter a sua (345 clusters perdidos assim numa corrida). Se a linha ja foi
  // reclamada por outro cluster desta corrida, ignora-se e cria-se uma nova.
  const nameKeyHit = existingByKey.get(key(name, brand));
  if (nameKeyHit && !claimedProductIds.has(nameKeyHit.id)) foundIds.add(nameKeyHit.id);

  let productId;
  let existingImageUrl = null;

  if (foundIds.size > 1) {
    // fusao de duplicados legados: sobrevive o mais antigo, os outros
    // re-apontam matched_prices/matched_product_sources para ele e sao
    // apagados.
    const rows = [...foundIds].map((id) => existingByKeyReverse.get(id)).filter(Boolean);
    rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const survivor = rows[0] || { id: [...foundIds][0] };
    productId = survivor.id;
    existingImageUrl = survivor.image_url ?? null;
    const losers = [...foundIds].filter((id) => id !== productId);
    // reclama antes de qualquer await: os clusters correm em paralelo por lotes
    for (const id of foundIds) claimedProductIds.add(id);
    for (const loserId of losers) {
      const { error: reparentPricesError } = await supabase.from("matched_prices").update({ product_id: productId }).eq("product_id", loserId);
      if (reparentPricesError) throw reparentPricesError;
      const { error: reparentSourcesError } = await supabase
        .from("matched_product_sources")
        .update({ product_id: productId })
        .eq("product_id", loserId);
      if (reparentSourcesError) throw reparentSourcesError;
      const { error: deleteError } = await supabase.from("matched_products").delete().eq("id", loserId);
      if (deleteError) throw deleteError;
      totalMerged++;
    }
  } else if (foundIds.size === 1) {
    productId = [...foundIds][0];
    claimedProductIds.add(productId);
    const meta = existingByKeyReverse.get(productId);
    existingImageUrl = meta?.image_url ?? null;
  }

  const alreadyInStorage = existingImageUrl?.includes(STORAGE_IMAGE_MARKER);
  const imageUrl = alreadyInStorage ? existingImageUrl : hotlinkImage || existingImageUrl || null;

  const record = {
    name,
    brand,
    category,
    subcategory,
    quantity: qty?.qty ?? null,
    quantity_unit: qty?.kind ?? null,
    image_url: imageUrl,
    confidence: "high",
    match_score: score,
  };

  if (productId) {
    const { error: updateError } = await supabase.from("matched_products").update(record).eq("id", productId);
    if (updateError) throw updateError;
    totalUpdated++;
  } else {
    const { data: inserted, error: insertError } = await supabase.from("matched_products").insert(record).select("id").single();
    if (insertError) throw insertError;
    productId = inserted.id;
    claimedProductIds.add(productId);
    totalInserted++;
  }

  existingByKey.set(key(name, brand), { id: productId, name, brand, image_url: imageUrl, created_at: new Date().toISOString() });
  existingByKeyReverse.set(productId, { id: productId, name, brand, image_url: imageUrl, created_at: new Date().toISOString() });

  const priceRows = [];
  for (const id of ids) {
    const n = nodeData.get(id);
    const loja = LOJA_NAME[n.store];
    const prev = latestPriceByKey.get(`${productId}|${loja}`);
    if (priceChanged(prev?.preco, n.price)) {
      priceRows.push({ product_id: productId, loja, preco: n.price, data: today });
    } else {
      totalPricesSkipped++;
    }
    sourceByNode.set(`${loja}::${n.url}`, productId);
  }
  if (priceRows.length) {
    const { error: priceError } = await supabase.from("matched_prices").insert(priceRows);
    if (priceError) {
      if (priceError.message.includes("matched_prices_loja_check")) {
        console.error(`BLOQUEADO: matched_prices_loja_check nao aceita uma destas lojas: ${priceRows.map((r) => r.loja).join(", ")}.`);
        blockedByConstraint = true;
        return;
      }
      throw priceError;
    }
    for (const r of priceRows) latestPriceByKey.set(`${r.product_id}|${r.loja}`, { preco: r.preco, data: r.data });
  }

  const sourceRows = ids.map((id) => {
    const n = nodeData.get(id);
    return { product_id: productId, loja: LOJA_NAME[n.store], url: n.url };
  });
  const { error: sourceError } = await supabase.from("matched_product_sources").upsert(sourceRows, { onConflict: "loja,url" });
  if (sourceError) throw sourceError;

  // Limpa origens de corridas anteriores que ja nao pertencem a este cluster
  // (a composicao muda quando o catalogo muda ou quando um edge passa a ser
  // rejeitado). Sem isto a tabela so cresce e um no que mudou de cluster fica
  // a apontar para os dois, o que faz o merge de duplicados apagar uma linha
  // legitima na corrida seguinte.
  const currentUrls = new Set(sourceRows.map((r) => r.url));
  const { data: storedSources, error: readSourcesError } = await supabase
    .from("matched_product_sources")
    .select("url")
    .eq("product_id", productId);
  if (readSourcesError) throw readSourcesError;
  const staleUrls = storedSources.map((r) => r.url).filter((u) => !currentUrls.has(u));
  if (staleUrls.length) {
    const { error: pruneError } = await supabase
      .from("matched_product_sources")
      .delete()
      .eq("product_id", productId)
      .in("url", staleUrls);
    if (pruneError) throw pruneError;
  }
}

for (let i = 0; i < clusters.length; i += CONCURRENT_UPDATES) {
  const chunk = clusters.slice(i, i + CONCURRENT_UPDATES);
  await Promise.all(chunk.map((c) => processCluster(c)));
  if (blockedByConstraint) break;
  if ((i + CONCURRENT_UPDATES) % 200 === 0 || i + CONCURRENT_UPDATES >= clusters.length) {
    console.log(`... ${Math.min(i + CONCURRENT_UPDATES, clusters.length)}/${clusters.length} clusters processados`);
  }
}

console.log("\n=== TOTAL ===");
console.log(`Inseridos: ${totalInserted} | Atualizados: ${totalUpdated} | Duplicados legados fundidos: ${totalMerged} | Para revisao: ${totalReview}`);
console.log(`Precos poupados (sem mudanca desde o ultimo registo): ${totalPricesSkipped}`);
if (blockedByConstraint) {
  console.log("PENDENTE de migration (loja bloqueada em matched_prices_loja_check) - corre a migration e repete.");
}

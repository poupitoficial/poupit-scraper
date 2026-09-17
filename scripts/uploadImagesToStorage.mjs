// Copia imagens de produto para o Supabase Storage em vez de manter links
// diretos para os sites das lojas - evita imagens partidas se a loja mudar
// URLs ou bloquear hotlinking, e da a mesma imagem ao produto em todas as
// lojas onde ele fez match (matched_products tem uma imagem por produto, nao
// por loja).
//
// Fonte por produto, por ordem de preferencia: continente > pingo-doce >
// auchan > lidl (primeira loja do par que tiver imagem disponivel nos dados
// de match). Cobre os 6 pares, nao so os que envolvem o Continente.
//
// Scope: so os produtos ja em matched_products com match de alta confianca -
// nao os milhares de produtos de cada loja que nunca sao comparados.
// So processa produtos cujo image_url atual ainda nao e do Storage
// (idempotente entre corridas).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BUCKET = "product-images";
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

const STORE_PRIORITY = ["continente", "pingo-doce", "auchan", "lidl", "aldi"];

const PAIR_FILES = [
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

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) throw error;
    console.log(`bucket "${BUCKET}" criado`);
  }
}

function extFromUrl(url) {
  const match = url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i);
  return match ? match[1].toLowerCase() : "jpg";
}

async function uploadOne(sourceStore, name, imageUrl) {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} a descarregar ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/jpeg";

  const safeName = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  const storagePath = `${sourceStore}/${safeName}-${Buffer.from(imageUrl).toString("base64url").slice(0, 12)}.${extFromUrl(imageUrl)}`;

  // cacheControl explicito (1 semana) - sem isto o SDK usa o default de
  // 3600s (1h), fazendo cada dispositivo voltar a pedir a mesma imagem ao
  // CDN a cada hora em vez de servir da cache local. Foi a causa da
  // emergencia de cached egress (ver scripts/fixStorageCacheControl.mjs) -
  // aquele script corrige as imagens ja enviadas, isto evita que volte a
  // acontecer com uploads novos.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true, cacheControl: "604800" });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return publicUrl.publicUrl;
}

async function fetchExistingImageUrls() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map(); // `${name}|${brand}` -> image_url atual
  while (true) {
    const { data, error } = await supabase
      .from("matched_products")
      .select("name, brand, image_url")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) map.set(`${row.name.trim().toLowerCase()}|${(row.brand || "").trim().toLowerCase()}`, row.image_url);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

function storeOf(label) {
  return label === "pingo-doce" ? "pingo-doce" : label;
}

const HOST_TO_STORE = {
  "www.continente.pt": "continente",
  "static.pingodoce.pt": "pingo-doce",
  "www.pingodoce.pt": "pingo-doce",
  "www.auchan.pt": "auchan",
  "www.lidl.pt": "lidl",
  "prd.an-pcm.com": "aldi",
};

function storeFromHost(imageUrl) {
  try {
    return HOST_TO_STORE[new URL(imageUrl).hostname] ?? "outro";
  } catch {
    return "outro";
  }
}

// Fase 2: produtos que nao tem match de alta confianca (por isso nao aparecem
// nos ficheiros de match) mas ja tem um image_url gravado em matched_products
// (hotlink de uma loja) - migra o que ja la esta, em vez de descartar so
// porque a confianca nunca foi verificada. Ordenados por match_score desc
// (alta confianca primeiro, como pedido), nulls por ultimo.
async function fetchHotlinkRows() {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await supabase
      .from("matched_products")
      .select("name, brand, image_url, match_score")
      .not("image_url", "is", null)
      .order("match_score", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const row of data) {
      if (!row.image_url.includes(`/storage/v1/object/public/${BUCKET}/`)) out.push(row);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  await ensureBucket();

  console.log("--- a carregar image_url atual de matched_products ---");
  const currentImageByKey = await fetchExistingImageUrls();
  console.log(`${currentImageByKey.size} produtos carregados.\n`);

  // Recolhe candidatos de todos os 6 pares, dedupe por name+brand, preferindo
  // a loja mais acima em STORE_PRIORITY quando o mesmo produto aparece em
  // mais do que um par com imagens de lojas diferentes.
  const candidates = new Map(); // key -> { name, brand, imageUrl, store, priority }
  for (const [labelA, labelB] of PAIR_FILES) {
    const fileName = `matches_${labelA}_${labelB}.json`;
    const file = path.join(root, "analysis", fileName);
    if (!fs.existsSync(file)) {
      console.log(`(sem ${fileName}, salta)`);
      continue;
    }
    const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
    const highConfidence = matches.filter((m) => !m.ownBrand && m.score >= HIGH_CONFIDENCE_THRESHOLD);
    for (const m of highConfidence) {
      const brand = m.a.brand || m.b.brand || "";
      const key = `${m.a.name.trim().toLowerCase()}|${brand.trim().toLowerCase()}`;
      const options = [
        { store: storeOf(labelA), name: m.a.name, imageUrl: m.a.imageUrl },
        { store: storeOf(labelB), name: m.b.name, imageUrl: m.b.imageUrl },
      ].filter((o) => o.imageUrl);
      for (const opt of options) {
        const priority = STORE_PRIORITY.indexOf(opt.store);
        const current = candidates.get(key);
        if (!current || priority < current.priority) {
          candidates.set(key, { name: opt.name, brand, imageUrl: opt.imageUrl, store: opt.store, priority });
        }
      }
    }
  }

  // So os que ainda nao apontam para o Storage (idempotente entre corridas).
  const toMigrate = [...candidates.entries()].filter(([key]) => {
    const current = currentImageByKey.get(key);
    return !current || !current.includes(`/storage/v1/object/public/${BUCKET}/`);
  });

  console.log(`${candidates.size} produtos candidatos (alta confianca, com imagem disponivel nalguma loja).`);
  console.log(`${toMigrate.length} ainda nao migrados para o Storage.\n`);

  const byStore = {};
  for (const [, c] of toMigrate) byStore[c.store] = (byStore[c.store] || 0) + 1;
  console.log("por loja de origem:", JSON.stringify(byStore), "\n");

  let uploaded = 0;
  let updated = 0;
  let errors = 0;
  const errorDetails = [];
  const migratedKeys = new Set();

  async function migrateOne(store, name, brand, imageUrl) {
    let storageUrl;
    try {
      storageUrl = await uploadOne(store, name, imageUrl);
      uploaded++;
    } catch (err) {
      errors++;
      errorDetails.push(`"${name}" (${store}): download/upload falhou - ${err.message}`);
      return;
    }
    const { error: updateError } = await supabase
      .from("matched_products")
      .update({ image_url: storageUrl })
      .eq("name", name)
      .eq("brand", brand);
    if (updateError) {
      errors++;
      errorDetails.push(`"${name}" (${store}): upload ok mas update da BD falhou - ${updateError.message}`);
    } else {
      updated++;
      migratedKeys.add(`${name.trim().toLowerCase()}|${brand.trim().toLowerCase()}`);
    }
    if (uploaded % 100 === 0) console.log(`... ${uploaded} imagens migradas`);
  }

  console.log(`--- fase 1: candidatos com match de alta confianca (${toMigrate.length}) ---`);
  for (const [, { name, brand, imageUrl, store }] of toMigrate) {
    await migrateOne(store, name, brand, imageUrl);
  }
  const phase1Uploaded = uploaded;

  console.log(`\n--- fase 2: resto dos hotlinks em matched_products (sem match de alta confianca, mas ja com imagem gravada) ---`);
  const hotlinkRows = await fetchHotlinkRows();
  const phase2Candidates = hotlinkRows.filter(
    (r) => !migratedKeys.has(`${r.name.trim().toLowerCase()}|${(r.brand || "").trim().toLowerCase()}`)
  );
  console.log(`${hotlinkRows.length} hotlinks encontrados, ${phase2Candidates.length} por migrar (resto ja tratado na fase 1).\n`);

  let skippedUnknownHost = 0;
  for (const row of phase2Candidates) {
    const store = storeFromHost(row.image_url);
    if (store === "outro") {
      skippedUnknownHost++;
      errorDetails.push(`"${row.name}": host desconhecido em ${row.image_url}, saltado`);
      continue;
    }
    await migrateOne(store, row.name, row.brand || "", row.image_url);
  }
  const phase2Uploaded = uploaded - phase1Uploaded;

  console.log(`\n--- Resumo ---`);
  console.log(`Fase 1 (alta confianca): ${phase1Uploaded} migradas`);
  console.log(`Fase 2 (resto): ${phase2Uploaded} migradas`);
  console.log(`Total uploads para o Storage: ${uploaded}`);
  console.log(`matched_products atualizados: ${updated}`);
  console.log(`Erros: ${errors} (${skippedUnknownHost} por host desconhecido)`);
  if (errorDetails.length) {
    console.log("\nDetalhe dos erros:");
    for (const d of errorDetails) console.log(" - " + d);
  }
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

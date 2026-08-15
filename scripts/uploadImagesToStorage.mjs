// Copia as imagens do Continente (fonte "a" nos matches, ver matchAll.mjs) para o
// Supabase Storage em vez de manter links diretos para o site deles - evita
// imagens partidas se o Continente mudar URLs ou bloquear hotlinking, e da a
// mesma imagem ao produto em todas as lojas onde ele fez match (matched_products
// tem uma imagem por produto, nao por loja).
//
// Scope: so os produtos que ja estao em matched_products (matches de alta
// confianca, ja inseridos por insertMatchesAll.mjs) - nao os ~15 mil produtos
// Continente todos, a maioria dos quais nunca e comparada entre lojas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BUCKET = "product-images";
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

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

async function uploadOne(name, imageUrl) {
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
  const storagePath = `continente/${safeName}-${Buffer.from(imageUrl).toString("base64url").slice(0, 12)}.${extFromUrl(imageUrl)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return publicUrl.publicUrl;
}

async function main() {
  await ensureBucket();

  const file = path.join(root, "analysis", "matches_continente_pingo-doce.json");
  const matches = JSON.parse(fs.readFileSync(file, "utf-8"));
  const highConfidence = matches.filter((m) => !m.ownBrand && m.score >= HIGH_CONFIDENCE_THRESHOLD && m.a.imageUrl);

  console.log(`${highConfidence.length} produtos de alta confianca com imagem do Continente para migrar`);

  let uploaded = 0;
  let updated = 0;
  let errors = 0;

  for (const m of highConfidence) {
    let storageUrl;
    try {
      storageUrl = await uploadOne(m.a.name, m.a.imageUrl);
      uploaded++;
    } catch (err) {
      errors++;
      console.error(`ERRO a fazer upload de "${m.a.name}": ${err.message}`);
      continue;
    }

    const { error: updateError, count } = await supabase
      .from("matched_products")
      .update({ image_url: storageUrl })
      .eq("name", m.a.name)
      .eq("brand", m.a.brand || m.b.brand || "");
    if (updateError) {
      errors++;
      console.error(`ERRO a atualizar matched_products "${m.a.name}": ${updateError.message}`);
    } else {
      updated++;
    }

    if (uploaded % 100 === 0) console.log(`... ${uploaded} imagens migradas`);
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Uploads para o Storage: ${uploaded}`);
  console.log(`matched_products atualizados: ${updated}`);
  console.log(`Erros: ${errors}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

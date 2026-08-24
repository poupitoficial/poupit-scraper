// Emergencia 2026-08-24: excedemos o limite de cached egress do Supabase (15,09GB
// de 5,5GB). Causa identificada: todos os objetos do bucket "product-images" foram
// enviados sem "cacheControl" explicito, por isso o SDK aplicou o default de 3600s
// (1h) - cada dispositivo volta a pedir a mesma imagem ao CDN a cada hora em vez de
// servir da cache local, multiplicando o egress sem os dados armazenados mudarem.
//
// O Storage nao tem um endpoint de "so metadata" sem reenviar o ficheiro (o
// update() do storage-js faz sempre PUT do corpo completo) - por isso o unico
// caminho e descarregar cada objeto e voltar a enviar com cacheControl novo.
// Custa ~467MB de egress (o tamanho total atual do bucket) uma unica vez, para
// parar a sangria repetida daqui para a frente.
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const BUCKET = "product-images";
const NEW_CACHE_CONTROL = "604800"; // 1 semana, como pedido
const FOLDERS = ["continente", "auchan", "pingo-doce"];
const CONCURRENCY = 15;

async function listAll(folder) {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    if (!data.length) break;
    all.push(...data.map((f) => ({ ...f, folder })));
    offset += data.length;
    if (data.length < 1000) break;
  }
  return all;
}

async function fixOne(obj) {
  const path = `${obj.folder}/${obj.name}`;
  if (obj.metadata?.cacheControl === `max-age=${NEW_CACHE_CONTROL}`) {
    return { path, skipped: true };
  }
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError) throw new Error(`download ${path}: ${downloadError.message}`);

  const { error: updateError } = await supabase.storage.from(BUCKET).update(path, blob, {
    cacheControl: NEW_CACHE_CONTROL,
    contentType: obj.metadata?.mimetype || "image/jpeg",
  });
  if (updateError) throw new Error(`update ${path}: ${updateError.message}`);
  return { path, skipped: false };
}

async function runWithConcurrency(items, limit, worker) {
  let idx = 0;
  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails = [];

  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try {
        const res = await worker(items[i]);
        if (res.skipped) skipped++;
        else fixed++;
      } catch (err) {
        errors++;
        errorDetails.push(err.message);
        if (errorDetails.length <= 10) console.error("ERRO:", err.message);
      }
      if ((fixed + skipped + errors) % 200 === 0) {
        console.log(`... ${fixed + skipped + errors}/${items.length} (fixed=${fixed} skipped=${skipped} errors=${errors})`);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, next));
  return { fixed, skipped, errors, errorDetails };
}

async function main() {
  console.log("--- a listar objetos ---");
  let all = [];
  for (const folder of FOLDERS) {
    const items = await listAll(folder);
    console.log(`${folder}: ${items.length} objetos`);
    all = all.concat(items);
  }
  console.log(`\nTotal: ${all.length} objetos a corrigir (cacheControl -> max-age=${NEW_CACHE_CONTROL})\n`);

  const result = await runWithConcurrency(all, CONCURRENCY, fixOne);

  console.log("\n=== RESUMO ===");
  console.log(`Corrigidos: ${result.fixed}`);
  console.log(`Ja estavam corretos (saltados): ${result.skipped}`);
  console.log(`Erros: ${result.errors}`);
  if (result.errors > 10) console.log(`(mostrados so os primeiros 10 erros acima, total ${result.errors})`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

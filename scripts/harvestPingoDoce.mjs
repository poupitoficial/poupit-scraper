import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPingoDoceProducts } from "../src/pingoDoceClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "pd_products_full.json");
const PROGRESS_EVERY = 200;
const CHECKPOINT_EVERY = 1000;

const products = [];
let errors = 0;
const startedAt = Date.now();

function save() {
  fs.writeFileSync(OUT, JSON.stringify(products, null, 2));
}

for await (const product of fetchPingoDoceProducts({
  delayMs: 250,
  onProductError: (url, err) => {
    errors++;
    console.log(`ERRO (${errors}) em ${url}: ${err.message}`);
  },
})) {
  products.push(product);

  if (products.length % PROGRESS_EVERY === 0) {
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`[pingo doce] ${products.length} produtos recolhidos, ${errors} erros, ${elapsedMin} min`);
  }
  if (products.length % CHECKPOINT_EVERY === 0) {
    save();
    console.log(`[pingo doce] checkpoint gravado em ${OUT}`);
  }
}

save();
const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log(`[pingo doce] CONCLUIDO: ${products.length} produtos, ${errors} erros, ${elapsedMin} min. Gravado em ${OUT}`);

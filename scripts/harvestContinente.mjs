import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCategoryProducts } from "../src/continenteClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "continente_products_full.json");
const PROGRESS_EVERY = 200;
const CHECKPOINT_EVERY = 1000;

const products = [];
let errors = 0;
const startedAt = Date.now();

function save() {
  fs.writeFileSync(OUT, JSON.stringify(products, null, 2));
}

for await (const product of fetchCategoryProducts({
  onCategoryError: (url, err) => {
    errors++;
    console.log(`ERRO (${errors}) em ${url}: ${err.message}`);
  },
})) {
  products.push(product);

  if (products.length % PROGRESS_EVERY === 0) {
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`[continente] ${products.length} produtos recolhidos, ${errors} erros, ${elapsedMin} min`);
  }
  if (products.length % CHECKPOINT_EVERY === 0) {
    save();
    console.log(`[continente] checkpoint gravado em ${OUT}`);
  }
}

save();
const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log(`[continente] CONCLUIDO: ${products.length} produtos, ${errors} erros, ${elapsedMin} min. Gravado em ${OUT}`);

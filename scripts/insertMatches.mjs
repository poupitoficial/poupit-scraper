import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { supabase } from "../src/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const matches = JSON.parse(fs.readFileSync(path.join(root, "analysis", "matches_all.json")));
const pd = JSON.parse(fs.readFileSync(path.join(root, "pd_products_full.json")));
const ct = JSON.parse(fs.readFileSync(path.join(root, "continente_products_full.json")));

const pdByUrl = new Map(pd.map((p) => [p.url, p]));
const ctByUrl = new Map(ct.map((p) => [p.url, p]));

const brandMatches = matches.filter((m) => !m.ownBrand);
const today = new Date().toISOString().slice(0, 10);

const rows = brandMatches.map((m) => {
  const category = pdByUrl.get(m.pd.url)?.category || ctByUrl.get(m.continente.url)?.category || null;
  const qty = m.pd.qty || m.continente.qty;
  return {
    product: {
      name: m.pd.name,
      brand: m.pd.brand,
      category,
      quantity: qty?.qty ?? null,
      quantity_unit: qty?.kind ?? null,
      // uma imagem por produto (nao por loja) - usa a do PD, com fallback para a do Continente
      image_url: m.pd.imageUrl || m.continente.imageUrl || null,
    },
    pdPrice: m.pd.price,
    ctPrice: m.continente.price,
  };
});

const CHUNK = 500;
let productsInserted = 0;
let pricesInserted = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);

  const { data: insertedProducts, error: productError } = await supabase
    .from("matched_products")
    .insert(chunk.map((r) => r.product))
    .select("id");

  if (productError) {
    console.error("ERRO a inserir matched_products:", productError.message);
    process.exit(1);
  }

  const priceRows = insertedProducts.flatMap((p, idx) => [
    { product_id: p.id, loja: "pingo_doce", preco: chunk[idx].pdPrice, data: today },
    { product_id: p.id, loja: "continente", preco: chunk[idx].ctPrice, data: today },
  ]);

  const { error: priceError } = await supabase.from("matched_prices").insert(priceRows);
  if (priceError) {
    console.error("ERRO a inserir matched_prices:", priceError.message);
    process.exit(1);
  }

  productsInserted += insertedProducts.length;
  pricesInserted += priceRows.length;
  console.log(`chunk ${i / CHUNK + 1}: +${insertedProducts.length} products, +${priceRows.length} prices`);
}

console.log(`\nCONCLUIDO: ${productsInserted} linhas em matched_products, ${pricesInserted} linhas em matched_prices`);

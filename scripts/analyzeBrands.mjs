import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pd = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pd_products_full.json")));
const ct = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "continente_products_full.json")));

function counts(arr, field) {
  const m = new Map();
  for (const p of arr) {
    const b = (p[field] || "(vazio)").trim();
    m.set(b, (m.get(b) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const pdBrands = counts(pd, "brand");
const ctBrands = counts(ct, "brand");

console.log("=== PD: total marcas distintas:", pdBrands.length, "===");
console.log(pdBrands.slice(0, 40).map(([b, n]) => `${b} (${n})`).join("\n"));

console.log("\n=== CT: total marcas distintas:", ctBrands.length, "===");
console.log(ctBrands.slice(0, 40).map(([b, n]) => `${b} (${n})`).join("\n"));

const outDir = path.join(__dirname, "..", "analysis");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "pd_brands.json"), JSON.stringify(pdBrands, null, 2));
fs.writeFileSync(path.join(outDir, "ct_brands.json"), JSON.stringify(ctBrands, null, 2));
console.log("\nlistas completas gravadas em analysis/pd_brands.json e analysis/ct_brands.json");

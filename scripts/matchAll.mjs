// Orquestra o matching entre os 4 supermercados: exporta o estado atual de cada
// um diretamente da BD (ja corrigido/reclassificado) e corre os 6 pares
// possiveis entre continente, pingo-doce, lidl e auchan.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchTwoSources, OWN_BRAND_RE } from "./matchLib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SOURCES = {
  continente: "continente_products_full.json",
  "pingo-doce": "pd_products_full.json",
  lidl: "lidl_products_full.json",
  auchan: "auchan_products_full.json",
  aldi: "aldi_products_full.json",
};

console.log("--- a exportar dados atuais da BD ---");
for (const [slug, file] of Object.entries(SOURCES)) {
  execFileSync("node", ["scripts/exportFromSupabase.mjs", slug, file], { cwd: root, stdio: "inherit" });
}

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf-8"));
}

const data = Object.fromEntries(Object.entries(SOURCES).map(([slug, file]) => [slug, load(file)]));

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

const outDir = path.join(root, "analysis");
fs.mkdirSync(outDir, { recursive: true });

console.log("\n--- a correr matching por par ---");
for (const [labelA, labelB] of PAIRS) {
  const matches = matchTwoSources(data[labelA], OWN_BRAND_RE[labelA], data[labelB], OWN_BRAND_RE[labelB]);
  const outFile = path.join(outDir, `matches_${labelA}_${labelB}.json`);
  fs.writeFileSync(outFile, JSON.stringify(matches, null, 2));
  const ownCount = matches.filter((m) => m.ownBrand).length;
  console.log(
    `${labelA} x ${labelB}: ${data[labelA].length} x ${data[labelB].length} produtos -> ${matches.length} matches ` +
      `(${matches.length - ownCount} marca fabricante, ${ownCount} marca propria). Gravado em ${outFile}`
  );
}

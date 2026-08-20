// So leitura - refetch dos URLs do sitemap_1 ainda nao guardados na BD (os
// 2122 "sem_classificacao" + outras exclusoes da corrida de 19 Ago, ja que
// os 4189 guardados com sucesso ja estao na BD e ficam de fora do filtro).
// Objetivo: mostrar os padroes de breadcrumb mais frequentes entre os
// "sem_classificacao", para decidir se sao categorias legitimas em falta
// nas regras ou seccoes fora de ambito.
import "dotenv/config";
import { supabase } from "./src/supabase.js";
import { collectSitemapProductUrls, parseBreadcrumb } from "./src/continenteClient.js";
import { classifyContinenteBreadcrumb } from "./src/continenteCategoryMap.js";

const ID_FROM_URL_RE = /-(\d+)\.html$/;
const LD_JSON_PRODUCT_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; poupit-scraper/1.0; +https://github.com/)", Accept: "text/html,application/xml" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

async function getExistingExternalIds(supermarketId) {
  const ids = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from("supermarket_products").select("external_id").eq("supermarket_id", supermarketId).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) ids.add(r.external_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function main() {
  const { data: sm } = await supabase.from("supermarkets").select("id").eq("slug", "continente").single();
  const [allUrls, existingIds] = await Promise.all([collectSitemapProductUrls(), getExistingExternalIds(sm.id)]);
  const remaining = allUrls.filter((u) => {
    const m = u.match(ID_FROM_URL_RE);
    return !m || !existingIds.has(m[1]);
  });
  console.log(`${allUrls.length} URLs no sitemap_1, ${existingIds.size} ja na BD, ${remaining.length} por reprocessar (exclusoes da corrida anterior).`);

  const reasonCounts = {};
  const breadcrumbPatterns = {};
  let processed = 0;
  const concurrency = 10;

  for (let i = 0; i < remaining.length; i += concurrency) {
    const batch = remaining.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (url) => {
        let html;
        try {
          html = await fetchText(url);
        } catch {
          reasonCounts.erro_rede = (reasonCounts.erro_rede || 0) + 1;
          return;
        }
        const ldMatch = html.match(LD_JSON_PRODUCT_RE);
        if (!ldMatch) {
          reasonCounts.sem_ld_json = (reasonCounts.sem_ld_json || 0) + 1;
          return;
        }
        let data;
        try {
          data = JSON.parse(ldMatch[1]);
        } catch {
          reasonCounts.erro_parse_json = (reasonCounts.erro_parse_json || 0) + 1;
          return;
        }
        if (!data.sku || !data.name || !data.offers) {
          reasonCounts.sem_dados_essenciais = (reasonCounts.sem_dados_essenciais || 0) + 1;
          return;
        }
        if (data.offers.availability && !/InStock/i.test(data.offers.availability)) {
          reasonCounts.fora_de_stock = (reasonCounts.fora_de_stock || 0) + 1;
          return;
        }
        const price = Number(data.offers.price);
        if (!Number.isFinite(price) || price === 0) {
          reasonCounts.preco_zero_ou_invalido = (reasonCounts.preco_zero_ou_invalido || 0) + 1;
          return;
        }
        const breadcrumb = parseBreadcrumb(html);
        const classification = classifyContinenteBreadcrumb(breadcrumb);
        if (!classification) {
          reasonCounts.sem_classificacao = (reasonCounts.sem_classificacao || 0) + 1;
          const pattern = breadcrumb.length ? breadcrumb.join(" / ") : "(sem breadcrumb)";
          breadcrumbPatterns[pattern] = (breadcrumbPatterns[pattern] || 0) + 1;
          return;
        }
        reasonCounts.classificado_ok = (reasonCounts.classificado_ok || 0) + 1;
      })
    );
    processed += batch.length;
    if (processed % 500 === 0 || processed === remaining.length) {
      console.log(`... ${processed}/${remaining.length} processados`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log("\n--- Razoes de exclusao (confirmacao vs. log da corrida anterior) ---");
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log("\n--- Padroes de breadcrumb mais frequentes entre os sem_classificacao ---");
  const sorted = Object.entries(breadcrumbPatterns).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sorted) {
    console.log(`  [${count}] ${pattern}`);
  }
  console.log(`\nTotal de padroes distintos: ${sorted.length}`);
}

main().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});

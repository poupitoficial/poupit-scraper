// Classificacao de subcategoria de "bebidas" por nome do produto. Usado como
// backfill pontual dos produtos de bebidas do Continente sem subcategoria
// (paginas de vinho/garrafeira nao tem breadcrumb - ver continenteClient.js).
// Padroes confirmados com o utilizador: cobrem 4964/4966 (99,96%) dos
// produtos de bebidas sem subcategoria na exportacao local.
import { wordForm } from "./pluralMatch.js";

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const NAME_RULES = [
  { test: /cerveja|sidra/i, subcategory: "cerveja" },
  {
    test: /vinho|champanhe|espumante|moscatel|lambrusco|frisante|colheita tardia|\btinto\b|\bbranco\b|\brose\b|chardonnay|alentejo|douro|bairrada|vinha da madeira|caixa madeira \d+ garraf/i,
    subcategory: "vinho",
  },
  {
    test: /licor|whisky|vodka|\bgin\b|\brum\b|tequila|aguardente|brandy|conhaque|cachaca|absinto|cocktail|bebida espirituosa|jeropiga|bagaceira|grappa|calvados|mezcal|pisco|ginja/i,
    subcategory: "bebidas_espirituosas",
  },
  { test: wordForm("agua"), subcategory: "agua" },
  {
    test: /sumo|refrigerante|nectar|isotonica|energetica|ice tea|smoothie|dose fruta|kombucha|gasosa|limonada|\bsoda\b|mocktail/i,
    subcategory: "refrigerantes_sumos",
  },
  { test: /\bcafe\b|\bcha\b|infus|tisana/i, subcategory: "cafe_cha" },
];

export function classifyBebidaByName(name) {
  const text = stripDiacritics((name || "").toLowerCase());
  for (const rule of NAME_RULES) {
    if (rule.test.test(text)) return rule.subcategory;
  }
  return null;
}

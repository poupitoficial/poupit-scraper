// Classifica um URL de produto do Pingo Doce (formato
// https://www.pingodoce.pt/home/produtos/<categoria>/<subcategoria>/.../<slug>-<id>.html)
// numa das 8 categorias suportadas, usando so os segmentos do proprio URL (o sitemap
// de produtos do Pingo Doce ja inclui a categoria completa no path, ao contrario do
// Continente). Devolve null para tudo o que fica fora das 8 categorias (limpeza,
// higiene, animais, take-away, promocoes sazonais, etc.).

const TOP_LEVEL_MAP = {
  "aguas-sumos-e-refrigerantes": "bebidas",
  vinhos: "bebidas",
  espirituosas: "bebidas",
  "cervejas-e-sidras": "bebidas",
  congelados: "congelados",
  "padaria-e-pastelaria": "padaria_pastelaria",
  "frutas-e-vegetais": "frutas_legumes",
  peixaria: "talho_peixaria",
  talho: "talho_peixaria",
  "leite-e-bebidas-vegetais": "laticinios_ovos",
  "manteiga-margarina-e-natas": "laticinios_ovos",
  ovos: "laticinios_ovos",
  "iogurtes-e-sobremesas": "laticinios_ovos",
  "bolachas-cereais-e-guloseimas": "mercearia_doce_salgada",
  "cafe-cha-e-achocolatados": "mercearia",
};

// "mercearia" e "charcutaria-e-queijos" no Pingo Doce misturam produtos de mais do
// que uma das nossas categorias, por isso precisam do 2o segmento do URL.
const SECOND_LEVEL_MAP = {
  mercearia: {
    "temperos-e-molhos": "mercearia",
    conservas: "mercearia",
    "arroz-massa-e-leguminosas": "mercearia",
    "farinha-fermento-e-acucar": "mercearia",
    "azeite-oleo-e-vinagre": "mercearia",
    "sopas-e-refeicoes-pre-preparadas": "mercearia",
    "batatas-fritas-snacks-e-frutos-secos": "mercearia_doce_salgada",
    sobremesas: "mercearia_doce_salgada",
    "compotas-mel-e-cremes-de-barrar": "mercearia_doce_salgada",
    "pao-e-bolos-embalados": "padaria_pastelaria",
  },
  "charcutaria-e-queijos": {
    queijos: "laticinios_ovos",
    // "charcutaria" fica de fora: nao corresponde a nenhuma das 8 categorias.
  },
};

export function classifyPdUrl(url) {
  const match = url.match(/\/home\/produtos\/([^/]+)\/([^/]+)?/);
  if (!match) return null;

  const [, first, second] = match;

  if (SECOND_LEVEL_MAP[first]) {
    return second ? (SECOND_LEVEL_MAP[first][second] ?? null) : null;
  }

  return TOP_LEVEL_MAP[first] ?? null;
}

// Classifica um URL de produto do Pingo Doce (formato
// https://www.pingodoce.pt/home/produtos/<categoria>/<subcategoria>/.../<slug>-<id>.html)
// numa das 11 categorias suportadas + subcategoria, usando so os segmentos do
// proprio URL (o sitemap de produtos do Pingo Doce ja inclui a categoria completa
// no path, nunca por palavra-chave no nome do produto). Devolve null para tudo o
// que fica fora das 11 categorias (take-away, promocoes sazonais, papelaria, etc.).

const TOP_LEVEL_MAP = {
  "aguas-sumos-e-refrigerantes": { category: "bebidas", subcategory: "refrigerantes_sumos" },
  vinhos: { category: "bebidas", subcategory: "vinho" },
  espirituosas: { category: "bebidas", subcategory: "bebidas_espirituosas" },
  "cervejas-e-sidras": { category: "bebidas", subcategory: "cerveja" },
  congelados: null, // resolvido por segundo nivel, ver SECOND_LEVEL_MAP
  "padaria-e-pastelaria": { category: "padaria_pastelaria", subcategory: "pao" },
  "frutas-e-vegetais": null, // resolvido por segundo nivel (fruta vs legumes)
  peixaria: { category: "talho_peixaria", subcategory: "peixe_fresco" },
  talho: null, // resolvido por segundo nivel
  "leite-e-bebidas-vegetais": { category: "laticinios_ovos", subcategory: "leite" },
  "manteiga-margarina-e-natas": { category: "laticinios_ovos", subcategory: "manteiga_natas" },
  ovos: { category: "laticinios_ovos", subcategory: "ovos" },
  "iogurtes-e-sobremesas": { category: "laticinios_ovos", subcategory: "iogurtes" },
  "bolachas-cereais-e-guloseimas": { category: "mercearia_doce_salgada", subcategory: "bolachas_cereais" },
  "cafe-cha-e-achocolatados": { category: "bebidas", subcategory: "cafe_cha" },
};

// Categorias em que o 1o segmento nao chega - o 2o segmento do URL e que decide
// categoria e/ou subcategoria.
const SECOND_LEVEL_MAP = {
  mercearia: {
    "temperos-e-molhos": { category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
    conservas: { category: "mercearia_doce_salgada", subcategory: "conservas" },
    "arroz-massa-e-leguminosas": { category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
    "farinha-fermento-e-acucar": { category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
    "azeite-oleo-e-vinagre": { category: "mercearia_doce_salgada", subcategory: "azeite_oleos" },
    "sopas-e-refeicoes-pre-preparadas": { category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
    "batatas-fritas-snacks-e-frutos-secos": { category: "mercearia_doce_salgada", subcategory: "snacks_aperitivos" },
    sobremesas: { category: "mercearia_doce_salgada", subcategory: "compotas_mel" },
    "compotas-mel-e-cremes-de-barrar": { category: "mercearia_doce_salgada", subcategory: "compotas_mel" },
    "pao-e-bolos-embalados": { category: "padaria_pastelaria", subcategory: "pao" },
  },
  "charcutaria-e-queijos": {
    queijos: { category: "laticinios_ovos", subcategory: "queijos" },
    // "charcutaria" fica de fora: nao corresponde a nenhuma das 11 categorias.
  },
  talho: {
    default: { category: "talho_peixaria", subcategory: "carne_vaca" },
  },
  "frutas-e-vegetais": {
    fruta: { category: "frutas_legumes", subcategory: "fruta" },
    fruta1: { category: "frutas_legumes", subcategory: "fruta" },
    legumes: { category: "frutas_legumes", subcategory: "legumes" },
    default: { category: "frutas_legumes", subcategory: "legumes" },
  },
  congelados: {
    default: { category: "congelados", subcategory: "pratos_prontos_congelados" },
  },
  "higiene-pessoal-e-beleza": {
    cabelo: { category: "higiene_pessoal_beleza", subcategory: "cuidado_cabelo" },
    corpo: { category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },
    rosto: { category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },
    "higiene-oral": { category: "higiene_pessoal_beleza", subcategory: "higiene_oral" },
    "higiene-intima": { category: "higiene_pessoal_beleza", subcategory: "higiene_intima" },
    "cuidados-solares": { category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },
  },
  "bebe-e-crianca": {
    "fraldas-e-toalhitas": { category: "bebe", subcategory: "fraldas" },
    alimentacao: { category: "bebe", subcategory: "leite_po_boioes" },
    "banho-e-higiene": { category: "bebe", subcategory: "cuidado_bebe" },
    "chupetas-e-acessorios": { category: "bebe", subcategory: "cuidado_bebe" },
  },
  limpeza: {
    roupa: { category: "casa_limpeza", subcategory: "detergente_roupa" },
    casa: { category: "casa_limpeza", subcategory: "limpeza_casa" },
    wc: { category: "casa_limpeza", subcategory: "limpeza_casa" },
    loica: { category: "casa_limpeza", subcategory: "loica" },
    "sacos-do-lixo": { category: "casa_limpeza", subcategory: "sacos_lixo" },
  },
  animais: {
    gato: { category: "animais_estimacao", subcategory: "racao_gato" },
    cao: { category: "animais_estimacao", subcategory: "racao_cao" },
    "outros-animais": { category: "animais_estimacao", subcategory: "acessorios_petiscos" },
  },
};

export function classifyPdUrl(url) {
  const match = url.match(/\/home\/produtos\/([^/]+)\/([^/]+)?/);
  if (!match) return null;

  const [, first, second] = match;

  if (SECOND_LEVEL_MAP[first]) {
    const table = SECOND_LEVEL_MAP[first];
    return (second && table[second]) || table.default || null;
  }

  return TOP_LEVEL_MAP[first] ?? null;
}

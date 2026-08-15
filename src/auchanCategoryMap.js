// Classifica um produto do Auchan a partir do breadcrumb real devolvido no proprio
// tile (data-gtm-new: item_category/item_category2/item_category3/item_category4),
// nunca por palavra-chave no nome do produto. Mesma logica de regras por ordem que
// o Lidl (ver lidlCategoryMap.js) - primeira regra que der match no breadcrumb
// completo (4 niveis concatenados) vence.

const RULES = [
  // laticinios_ovos
  { test: /\bleite\b/i, category: "laticinios_ovos", subcategory: "leite" },
  { test: /iogurte/i, category: "laticinios_ovos", subcategory: "iogurtes" },
  { test: /queijo/i, category: "laticinios_ovos", subcategory: "queijos" },
  { test: /manteiga|natas/i, category: "laticinios_ovos", subcategory: "manteiga_natas" },
  { test: /\bovos?\b/i, category: "laticinios_ovos", subcategory: "ovos" },
  { test: /sobremesa.*lacte|lacte.*sobremesa/i, category: "laticinios_ovos", subcategory: "sobremesas_lacteas" },
  { test: /bebida.*vegetal|vegegurte/i, category: "laticinios_ovos", subcategory: "bebidas_iogurtes_vegetais" },

  // talho_peixaria
  { test: /vaca|bovino|novilho|vitela/i, category: "talho_peixaria", subcategory: "carne_vaca" },
  { test: /porco|suino/i, category: "talho_peixaria", subcategory: "carne_porco" },
  { test: /frango|aves|peru|pato|coelho/i, category: "talho_peixaria", subcategory: "aves" },
  { test: /marisco|camarao|lulas|polvo|choco/i, category: "talho_peixaria", subcategory: "marisco" },
  { test: /charcutaria|fiambre|salame|chourico|presunto|salsicha|linguica/i, category: "talho_peixaria", subcategory: "charcutaria_enchidos" },
  { test: /peixaria|peixe|bacalhau|salmao/i, category: "talho_peixaria", subcategory: "peixe_fresco" },

  // frutas_legumes
  { test: /frutos secos|desidratad/i, category: "frutas_legumes", subcategory: "frutos_secos" },
  { test: /ervas aromaticas|especiarias/i, category: "frutas_legumes", subcategory: "ervas_aromaticas" },
  { test: /salada.*pronta|4a gama/i, category: "frutas_legumes", subcategory: "saladas_prontas" },
  { test: /\bfruta\b/i, category: "frutas_legumes", subcategory: "fruta" },
  { test: /legum|hortalic/i, category: "frutas_legumes", subcategory: "legumes" },

  // mercearia_doce_salgada (antes de padaria_pastelaria: "Bolachas e Bolos" e o
  // nome real de uma categoria de mercearia no site do Auchan e contem "bolo",
  // por isso "bolacha" tem de ser verificado primeiro)
  { test: /bolacha|biscoito|cereal|barra/i, category: "mercearia_doce_salgada", subcategory: "bolachas_cereais" },
  { test: /massa|arroz|leguminosa/i, category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
  { test: /conserva/i, category: "mercearia_doce_salgada", subcategory: "conservas" },
  { test: /azeite|oleo aliment/i, category: "mercearia_doce_salgada", subcategory: "azeite_oleos" },
  { test: /molho|tempero|especiaria|sal\b/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
  { test: /snack|aperitivo|batata frita/i, category: "mercearia_doce_salgada", subcategory: "snacks_aperitivos" },
  { test: /chocolate|rebucado|goma/i, category: "mercearia_doce_salgada", subcategory: "chocolates_doces" },
  { test: /compota|doce|mel\b|marmelada/i, category: "mercearia_doce_salgada", subcategory: "compotas_mel" },

  // padaria_pastelaria
  { test: /croissant|folhado/i, category: "padaria_pastelaria", subcategory: "croissants_folhados" },
  { test: /torrada|tosta/i, category: "padaria_pastelaria", subcategory: "torradas_tostas" },
  { test: /bolo|pastelaria|pasteis/i, category: "padaria_pastelaria", subcategory: "bolos_pastelaria" },
  { test: /\bpao\b|padaria/i, category: "padaria_pastelaria", subcategory: "pao" },

  // congelados
  { test: /gelado/i, category: "congelados", subcategory: "gelados" },
  { test: /congelad.*legum|legum.*congelad|congelad.*vegetal/i, category: "congelados", subcategory: "vegetais_congelados" },
  { test: /congelad.*peixe|congelad.*marisco|peixe.*congelad/i, category: "congelados", subcategory: "peixe_marisco_congelado" },
  { test: /congelad.*carne|carne.*congelad/i, category: "congelados", subcategory: "carne_congelada" },
  { test: /congelad.*massa|congelad.*pizza|pizza.*congelad/i, category: "congelados", subcategory: "massa_pizza_congelada" },
  { test: /prato.*pronto|refeicao.*pronta/i, category: "congelados", subcategory: "pratos_prontos_congelados" },

  // bebidas (excluir cerveja/vinho antes do genérico "bebidas espirituosas e vinhos")
  { test: /cerveja|sidra/i, category: "bebidas", subcategory: "cerveja" },
  { test: /vinho|champanhe|espumante/i, category: "bebidas", subcategory: "vinho" },
  { test: /espirituos|licor|whisky|vodka|gin\b|rum\b/i, category: "bebidas", subcategory: "bebidas_espirituosas" },
  { test: /\bagua\b/i, category: "bebidas", subcategory: "agua" },
  { test: /sumo|refrigerante|nectar/i, category: "bebidas", subcategory: "refrigerantes_sumos" },
  { test: /cafe|cha\b|infus/i, category: "bebidas", subcategory: "cafe_cha" },

  // higiene_pessoal_beleza
  { test: /cabelo|champo|shampoo/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_cabelo" },
  { test: /higiene oral|dentifrico|escova.*dente/i, category: "higiene_pessoal_beleza", subcategory: "higiene_oral" },
  { test: /higiene intima/i, category: "higiene_pessoal_beleza", subcategory: "higiene_intima" },
  { test: /desodorizante/i, category: "higiene_pessoal_beleza", subcategory: "desodorizantes" },
  { test: /depila/i, category: "higiene_pessoal_beleza", subcategory: "depilacao" },
  { test: /corpo|rosto|pele|creme|solar|banho|duche/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },

  // bebe
  { test: /fralda/i, category: "bebe", subcategory: "fraldas" },
  { test: /leite.*bebe|leite.*infantil|papa\b|boiao/i, category: "bebe", subcategory: "leite_po_boioes" },
  { test: /toalhita/i, category: "bebe", subcategory: "toalhitas" },
  { test: /bebe|infantil/i, category: "bebe", subcategory: "cuidado_bebe" },

  // casa_limpeza
  { test: /detergente.*roupa|roupa.*detergente|lavandaria/i, category: "casa_limpeza", subcategory: "detergente_roupa" },
  { test: /loica/i, category: "casa_limpeza", subcategory: "loica" },
  { test: /papel higienico|absorvente|toalhas.*papel/i, category: "casa_limpeza", subcategory: "papel_higienico_absorventes" },
  { test: /sacos.*lixo/i, category: "casa_limpeza", subcategory: "sacos_lixo" },
  { test: /limpeza|cuidados do lar/i, category: "casa_limpeza", subcategory: "limpeza_casa" },

  // animais_estimacao
  { test: /racao.*cao|comida.*cao\b|\bcao\b/i, category: "animais_estimacao", subcategory: "racao_cao" },
  { test: /racao.*gato|comida.*gato|\bgato\b/i, category: "animais_estimacao", subcategory: "racao_gato" },
  { test: /areia.*gato/i, category: "animais_estimacao", subcategory: "areia_gatos" },
  { test: /animais|animal/i, category: "animais_estimacao", subcategory: "acessorios_petiscos" },
];

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function classifyAuchanBreadcrumb(cat1, cat2, cat3, cat4) {
  const breadcrumb = stripDiacritics([cat1, cat2, cat3, cat4].filter(Boolean).join(" / "));
  if (!breadcrumb) return null;
  for (const rule of RULES) {
    if (rule.test.test(breadcrumb)) return { category: rule.category, subcategory: rule.subcategory };
  }
  return null;
}

export const OWN_BRAND_RE = /^(auchan|pouce|cosmia)/i;

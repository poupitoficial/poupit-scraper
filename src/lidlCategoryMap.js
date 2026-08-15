// Classifica um produto do Lidl a partir do breadcrumb real devolvido pela API
// (keyfacts.wonCategoryPrimary, ex. "Mundos de necessidade/Alimentos e quase
// alimentos/Queijos, laticinios e ovos/Iogurte"). Nunca por palavra-chave no nome
// do produto - so pelo breadcrumb da propria Lidl.
//
// Regras avaliadas por ordem, primeira que der match (substring, case-insensitive)
// vence. Tudo o que nao corresponde a nenhuma regra (bricolage, jardim, moda,
// decoracao, cozinha/utensilios, etc.) fica de fora das 11 categorias suportadas.

const RULES = [
  // bebidas (vinho/cerveja/espirituosas tratados a parte - ver classifyLidlBreadcrumb,
  // o nome da categoria-mae "Vinho, cerveja e bebidas espirituosas" contem as 3
  // palavras e faria match errado por substring simples)
  { test: /bebidas\/agua/i, category: "bebidas", subcategory: "agua" },
  { test: /sucos de fruta|refrigerantes/i, category: "bebidas", subcategory: "refrigerantes_sumos" },
  { test: /cafe|cha\b/i, category: "bebidas", subcategory: "cafe_cha" },

  // talho_peixaria
  { test: /churrasco e charcutaria/i, category: "talho_peixaria", subcategory: "charcutaria_enchidos" },
  { test: /carne de vaca/i, category: "talho_peixaria", subcategory: "carne_vaca" },
  { test: /carne de porco/i, category: "talho_peixaria", subcategory: "carne_porco" },
  { test: /\baves\b/i, category: "talho_peixaria", subcategory: "aves" },
  { test: /peixe e marisco(?! congelados)/i, category: "talho_peixaria", subcategory: "peixe_fresco" },

  // frutas_legumes
  { test: /frutas e legumes\/fruta$/i, category: "frutas_legumes", subcategory: "fruta" },
  { test: /frutas e legumes\/legumes/i, category: "frutas_legumes", subcategory: "legumes" },
  { test: /frutos secos e nozes/i, category: "frutas_legumes", subcategory: "frutos_secos" },
  { test: /saladas, fruta e antepastos/i, category: "frutas_legumes", subcategory: "saladas_prontas" },

  // padaria_pastelaria
  { test: /padaria\/pastelaria/i, category: "padaria_pastelaria", subcategory: "bolos_pastelaria" },
  { test: /torradas e produtos de panificacao/i, category: "padaria_pastelaria", subcategory: "torradas_tostas" },

  // congelados
  { test: /peixe e marisco congelados/i, category: "congelados", subcategory: "peixe_marisco_congelado" },
  { test: /alimentos congelados.*gelado/i, category: "congelados", subcategory: "gelados" },
  { test: /frutas e legumes congelados/i, category: "congelados", subcategory: "vegetais_congelados" },
  { test: /pizzas e petiscos congelados/i, category: "congelados", subcategory: "massa_pizza_congelada" },
  { test: /alimentos congelados.*carne/i, category: "congelados", subcategory: "carne_congelada" },
  { test: /refeicoes prontas refrigeradas|refeicoes prontas congeladas/i, category: "congelados", subcategory: "pratos_prontos_congelados" },

  // laticinios_ovos
  { test: /iogurte/i, category: "laticinios_ovos", subcategory: "iogurtes" },
  { test: /\bovos\b/i, category: "laticinios_ovos", subcategory: "ovos" },
  { test: /\bqueijo\b/i, category: "laticinios_ovos", subcategory: "queijos" },
  { test: /manteiga/i, category: "laticinios_ovos", subcategory: "manteiga_natas" },
  { test: /leite e natas/i, category: "laticinios_ovos", subcategory: "leite" },
  { test: /queijos, laticinios e ovos\/sobremesas/i, category: "laticinios_ovos", subcategory: "sobremesas_lacteas" },

  // mercearia_doce_salgada
  { test: /arroz, massa e leguminosas/i, category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
  { test: /conservas/i, category: "mercearia_doce_salgada", subcategory: "conservas" },
  { test: /oleos e gorduras|gorduras, oleos, vinagre/i, category: "mercearia_doce_salgada", subcategory: "azeite_oleos" },
  { test: /molhos e condimentos/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
  { test: /petiscos salgados/i, category: "mercearia_doce_salgada", subcategory: "snacks_aperitivos" },
  { test: /produtos de chocolate/i, category: "mercearia_doce_salgada", subcategory: "chocolates_doces" },
  { test: /bolachas e doces/i, category: "mercearia_doce_salgada", subcategory: "bolachas_cereais" },
  { test: /ingredientes para panificacao/i, category: "mercearia_doce_salgada", subcategory: "massas_arroz" },

  // higiene_pessoal_beleza
  { test: /cuidados com o corpo e o rosto/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },
  { test: /higiene oral/i, category: "higiene_pessoal_beleza", subcategory: "higiene_oral" },
  { test: /cuidados com o cabelo/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_cabelo" },
  { test: /higiene intima/i, category: "higiene_pessoal_beleza", subcategory: "higiene_intima" },
  { test: /desodoriza/i, category: "higiene_pessoal_beleza", subcategory: "desodorizantes" },
  { test: /depila/i, category: "higiene_pessoal_beleza", subcategory: "depilacao" },

  // bebe
  { test: /alimentos para bebes e leite em po/i, category: "bebe", subcategory: "leite_po_boioes" },
  { test: /fraldas/i, category: "bebe", subcategory: "fraldas" },
  { test: /toalhitas/i, category: "bebe", subcategory: "toalhitas" },
  { test: /bebes e criancas/i, category: "bebe", subcategory: "cuidado_bebe" },

  // casa_limpeza
  { test: /detergentes e cuidados com a roupa/i, category: "casa_limpeza", subcategory: "detergente_roupa" },
  { test: /produtos de limpeza/i, category: "casa_limpeza", subcategory: "limpeza_casa" },
  { test: /papel higienico/i, category: "casa_limpeza", subcategory: "papel_higienico_absorventes" },
  { test: /sacos (de )?lixo/i, category: "casa_limpeza", subcategory: "sacos_lixo" },
  { test: /loica/i, category: "casa_limpeza", subcategory: "loica" },

  // animais_estimacao
  { test: /racao.*cao|comida.*cao\b/i, category: "animais_estimacao", subcategory: "racao_cao" },
  { test: /racao.*gato|comida.*gato/i, category: "animais_estimacao", subcategory: "racao_gato" },
  { test: /areia.*gato/i, category: "animais_estimacao", subcategory: "areia_gatos" },
  { test: /animais/i, category: "animais_estimacao", subcategory: "acessorios_petiscos" },
];

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function classifyLidlBreadcrumb(breadcrumb) {
  if (!breadcrumb) return null;
  const normalized = stripDiacritics(breadcrumb);
  const segments = normalized.split("/").map((s) => s.trim());

  // "Vinho, cerveja e bebidas espirituosas" mistura as 3 palavras no nome da
  // categoria-mae; decide-se pelo segmento seguinte (leaf real), nao por substring.
  if (/^vinho, cerveja e bebidas espirituosas$/i.test(segments[1] ?? "")) {
    const leaf = segments[2] ?? "";
    if (/champanhe|espumante/i.test(leaf)) return { category: "bebidas", subcategory: "vinho" };
    if (/cerveja/i.test(leaf)) return { category: "bebidas", subcategory: "cerveja" };
    if (/espirituosas/i.test(leaf)) return { category: "bebidas", subcategory: "bebidas_espirituosas" };
    if (/vinho/i.test(leaf)) return { category: "bebidas", subcategory: "vinho" };
    return null;
  }

  for (const rule of RULES) {
    if (rule.test.test(normalized)) return { category: rule.category, subcategory: rule.subcategory };
  }
  return null;
}

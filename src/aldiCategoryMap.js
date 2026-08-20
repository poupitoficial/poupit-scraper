// Classifica um produto do Aldi a partir do NOME (nao ha breadcrumb de
// categoria na pagina de produto, ao contrario de Continente/Pingo Doce/
// Auchan/Lidl - ver relatorio de viabilidade). Por isso o risco de erro e
// maior aqui: uma palavra no nome pode nao refletir a categoria real tao bem
// como um breadcrumb do proprio site. Mesma logica de regras por ordem e
// mesmo mecanismo de plurais tolerantes que auchanCategoryMap.js.

// pluralForms/wordForm/altForms movidos para src/pluralMatch.js (partilhado
// com Auchan e Continente) - ver esse ficheiro para o racional.
import { wordForm, altForms } from "./pluralMatch.js";

const RULES = [
  // laticinios_ovos
  { test: wordForm("leite"), category: "laticinios_ovos", subcategory: "leite" },
  { test: /iogurte/i, category: "laticinios_ovos", subcategory: "iogurtes" },
  { test: /queijo/i, category: "laticinios_ovos", subcategory: "queijos" },
  { test: /manteiga|natas/i, category: "laticinios_ovos", subcategory: "manteiga_natas" },
  { test: /\bovos?\b/i, category: "laticinios_ovos", subcategory: "ovos" },
  { test: /sobremesa.*lacte|lacte.*sobremesa|pudim|mousse/i, category: "laticinios_ovos", subcategory: "sobremesas_lacteas" },
  { test: new RegExp(`bebida.*(${altForms("vegetal")})|vegegurte`, "i"), category: "laticinios_ovos", subcategory: "bebidas_iogurtes_vegetais" },

  { test: /\bcaldo\b/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },

  // talho_peixaria
  { test: /vaca|bovino|novilho|vitela/i, category: "talho_peixaria", subcategory: "carne_vaca" },
  // "cachaco"/"leitao" sao nomes de corte/produto especificos de porco que
  // nao contem a palavra generica "porco" no nome (ex. "Costeletas do
  // Cachaco", "Rissol de Leitao")
  { test: /porco|suino|cachaco|leitao/i, category: "talho_peixaria", subcategory: "carne_porco" },
  { test: /frango|aves|peru|pato|coelho/i, category: "talho_peixaria", subcategory: "aves" },
  { test: /marisco|camarao|lulas|polvo|\bchocos?\b/i, category: "talho_peixaria", subcategory: "marisco" },
  { test: /charcutaria|fiambre|salame|chourico|presunto|salsicha|linguica/i, category: "talho_peixaria", subcategory: "charcutaria_enchidos" },
  { test: /peixaria|peixe|bacalhau|salmao|atum/i, category: "talho_peixaria", subcategory: "peixe_fresco" },

  // frutas_legumes
  { test: /frutos secos|desidratad/i, category: "frutas_legumes", subcategory: "frutos_secos" },
  { test: /ervas aromaticas|especiarias/i, category: "frutas_legumes", subcategory: "ervas_aromaticas" },
  { test: /salada.*pronta|4a gama/i, category: "frutas_legumes", subcategory: "saladas_prontas" },
  { test: wordForm("fruta"), category: "frutas_legumes", subcategory: "fruta" },
  { test: /legum|hortalic/i, category: "frutas_legumes", subcategory: "legumes" },

  // mercearia_doce_salgada (bolacha antes de padaria: mesmo padrao de colisao
  // ja visto no Auchan - "Bolachas e Bolos" tende a aparecer junto)
  { test: /bolacha|biscoito|cereal|barra/i, category: "mercearia_doce_salgada", subcategory: "bolachas_cereais" },
  // lasanha/nhoque/gnocchi e qualquer coisa "para <eletrodomestico>" (ex.
  // "Gnocchi para Airfryer") sao vendidos como prato pronto a aquecer, nao
  // como massa seca crua - tratado como prato pronto ANTES da regra generica
  // de massas (ver desambiguacao junto a "congelados" mais abaixo, mas fica
  // aqui porque tem de vencer "massa|esparguete" antes dessa regra correr).
  { test: /lasanha|nhoque|gnocchi|\bpara\s+(airfryer|forno|micro-?ondas)\b/i, category: "congelados", subcategory: "pratos_prontos_congelados" },
  { test: /massa|esparguete|arroz|leguminosa|farinha/i, category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
  { test: /conserva|pickles/i, category: "mercearia_doce_salgada", subcategory: "conservas" },
  { test: /azeite|oleo aliment/i, category: "mercearia_doce_salgada", subcategory: "azeite_oleos" },
  { test: /molho|tempero|especiaria|sal\b|maionese|ketchup|mostarda/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
  { test: /snack|aperitivo|batata frita|tortilhas/i, category: "mercearia_doce_salgada", subcategory: "snacks_aperitivos" },
  { test: /chocolate|rebucado|goma|bombons?/i, category: "mercearia_doce_salgada", subcategory: "chocolates_doces" },
  { test: /compota|doce extra|mel\b|marmelada/i, category: "mercearia_doce_salgada", subcategory: "compotas_mel" },

  // padaria_pastelaria
  { test: /croissant|folhado/i, category: "padaria_pastelaria", subcategory: "croissants_folhados" },
  { test: /torrada|tosta/i, category: "padaria_pastelaria", subcategory: "torradas_tostas" },
  { test: /bolo|pastelaria|pasteis/i, category: "padaria_pastelaria", subcategory: "bolos_pastelaria" },
  { test: new RegExp(`\\b(${altForms("pao")})\\b|padaria`, "i"), category: "padaria_pastelaria", subcategory: "pao" },

  // congelados
  { test: /gelado/i, category: "congelados", subcategory: "gelados" },
  { test: /congelad.*legum|legum.*congelad|congelad.*vegetal/i, category: "congelados", subcategory: "vegetais_congelados" },
  { test: /congelad.*peixe|congelad.*marisco|peixe.*congelad/i, category: "congelados", subcategory: "peixe_marisco_congelado" },
  { test: /congelad.*carne|carne.*congelad/i, category: "congelados", subcategory: "carne_congelada" },
  { test: /congelad.*massa|congelad.*pizza|pizza.*congelad/i, category: "congelados", subcategory: "massa_pizza_congelada" },
  { test: /prato.*pronto|refeicao.*pronta/i, category: "congelados", subcategory: "pratos_prontos_congelados" },

  // bebidas
  { test: /cerveja|sidra/i, category: "bebidas", subcategory: "cerveja" },
  { test: /vinho|champanhe|espumante/i, category: "bebidas", subcategory: "vinho" },
  { test: /espirituos|licor|whisky|vodka|gin\b|rum\b/i, category: "bebidas", subcategory: "bebidas_espirituosas" },
  { test: wordForm("agua"), category: "bebidas", subcategory: "agua" },
  { test: /sumo|refrigerante|nectar|energetic/i, category: "bebidas", subcategory: "refrigerantes_sumos" },
  { test: /cafe|cha\b|infus/i, category: "bebidas", subcategory: "cafe_cha" },

  // higiene_pessoal_beleza
  { test: /cabelo|champo|shampoo/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_cabelo" },
  { test: /higiene oral|dentifrico|escova.*dente/i, category: "higiene_pessoal_beleza", subcategory: "higiene_oral" },
  { test: /higiene intima/i, category: "higiene_pessoal_beleza", subcategory: "higiene_intima" },
  { test: /desodorizante/i, category: "higiene_pessoal_beleza", subcategory: "desodorizantes" },
  { test: /depila/i, category: "higiene_pessoal_beleza", subcategory: "depilacao" },
  { test: /corpo|rosto|pele|creme|solar|banho|duche|sabonete/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },

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
  { test: new RegExp(`racao.*(${altForms("cao")})|comida.*(${altForms("cao")})|\\b(${altForms("cao")})\\b`, "i"), category: "animais_estimacao", subcategory: "racao_cao" },
  { test: new RegExp(`racao.*(${altForms("gato")})|comida.*(${altForms("gato")})|\\b(${altForms("gato")})\\b`, "i"), category: "animais_estimacao", subcategory: "racao_gato" },
  { test: /areia.*gato/i, category: "animais_estimacao", subcategory: "areia_gatos" },
  { test: /animais|animal/i, category: "animais_estimacao", subcategory: "acessorios_petiscos" },
];

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// So a lista de 11 categorias validas no schema - o catalogo do Aldi mistura
// muito nao-alimentar rotativo (roupa, ferramentas, utensilios de cozinha)
// que nao encaixa em nenhuma delas e por isso devolve null de proposito
// (excluido, tal como o Auchan exclui maquilhagem/perfumes).
export function classifyAldiProduct(name) {
  const text = stripDiacritics((name || "").toLowerCase());
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.test.test(text)) return { category: rule.category, subcategory: rule.subcategory };
  }
  return null;
}

// Confirmado por amostragem real de 15 produtos (brandName no PRODUCT_DETAIL_GET):
// crofton, frantastique, up2fashion, workzone, cucina, ravini, deco craft,
// power force, milsani. "choceur" e marca de chocolate conhecida da Aldi
// Nord noutros mercados, mantida por precaucao mas nao confirmada em .pt.
export const OWN_BRAND_RE = /^(aldi|crofton|frantastique|up2fashion|workzone|cucina|ravini|deco craft|power force|milsani|choceur)/i;

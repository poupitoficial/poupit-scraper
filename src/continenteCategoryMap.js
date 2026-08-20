// Classifica um produto do Continente a partir do breadcrumb real da pagina
// de produto individual (microdata BreadcrumbList, ver continenteClient.js),
// usado pela via sitemap+PDP - nunca por palavra-chave no nome do produto.
// Mesmo desenho de regras por ordem e mesmo mecanismo de plurais tolerantes
// que Auchan/Aldi (ver auchanCategoryMap.js / pluralMatch.js).
//
// Nota: esta via cobre so sitemap_1-product.xml (~20000 URLs), que por
// amostragem nao inclui bebidas/alcool (ficam nos sitemaps 4/8/12, nao
// visitados nesta ronda - ver SESSAO_RESUMO ou historico de decisao). As
// regras de "bebidas" abaixo ficam por precaucao (um produto de bebidas que
// apareca aqui por acaso ainda fica bem classificado), mas nao se espera
// volume relevante vindo desta via.
import { wordForm, altForms } from "./pluralMatch.js";

const RULES = [
  // laticinios_ovos
  { test: wordForm("leite"), category: "laticinios_ovos", subcategory: "leite" },
  { test: /iogurte/i, category: "laticinios_ovos", subcategory: "iogurtes" },
  { test: /queijo/i, category: "laticinios_ovos", subcategory: "queijos" },
  { test: /manteiga|natas|bechamel/i, category: "laticinios_ovos", subcategory: "manteiga_natas" },
  { test: /\bovos?\b/i, category: "laticinios_ovos", subcategory: "ovos" },
  { test: /gelatina|mousse|pudim/i, category: "laticinios_ovos", subcategory: "sobremesas_lacteas" },
  { test: new RegExp(`bebida.*(${altForms("vegetal")})|vegegurte`, "i"), category: "laticinios_ovos", subcategory: "bebidas_iogurtes_vegetais" },

  { test: /\bcaldo\b/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },

  // talho_peixaria
  { test: /vaca|bovino|novilho|vitela|cabrito|borrego/i, category: "talho_peixaria", subcategory: "carne_vaca" },
  { test: /porco|suino/i, category: "talho_peixaria", subcategory: "carne_porco" },
  { test: /frango|aves|peru|pato|coelho/i, category: "talho_peixaria", subcategory: "aves" },
  { test: /marisco|camarao|lulas|polvo|\bchocos?\b/i, category: "talho_peixaria", subcategory: "marisco" },
  { test: /charcutaria|fiambre|salame|chourico|presunto|salsicha|linguica|pronto a cozinhar/i, category: "talho_peixaria", subcategory: "charcutaria_enchidos" },
  { test: /peixaria|peixe|bacalhau|salmao/i, category: "talho_peixaria", subcategory: "peixe_fresco" },

  // frutas_legumes (mesma precaucao do Auchan - chocolate/sumo antes das
  // regras genericas de frutos secos/fruta, caso o breadcrumb misture temas)
  { test: /chocolate/i, category: "mercearia_doce_salgada", subcategory: "chocolates_doces" },
  { test: /\bsumo\b|nectar/i, category: "bebidas", subcategory: "refrigerantes_sumos" },
  { test: /frutos secos|desidratad/i, category: "frutas_legumes", subcategory: "frutos_secos" },
  { test: /ervas aromaticas|especiarias/i, category: "frutas_legumes", subcategory: "ervas_aromaticas" },
  { test: /salada.*pronta|4a gama/i, category: "frutas_legumes", subcategory: "saladas_prontas" },
  { test: wordForm("fruta"), category: "frutas_legumes", subcategory: "fruta" },
  { test: /legum|hortalic/i, category: "frutas_legumes", subcategory: "legumes" },

  // mercearia_doce_salgada
  { test: /bolacha|biscoito|cereal|barra/i, category: "mercearia_doce_salgada", subcategory: "bolachas_cereais" },
  { test: /massa|arroz|leguminosa|farinha|couscous|quinoa|bulgur|noodles|pure/i, category: "mercearia_doce_salgada", subcategory: "massas_arroz" },
  { test: /conserva/i, category: "mercearia_doce_salgada", subcategory: "conservas" },
  { test: /azeite|oleo aliment|vinagre/i, category: "mercearia_doce_salgada", subcategory: "azeite_oleos" },
  { test: /molho|tempero|especiaria|sal\b|maionese|ketchup|mostarda|sopa/i, category: "mercearia_doce_salgada", subcategory: "molhos_temperos" },
  { test: /snack|aperitivo|batata frita|pipoca/i, category: "mercearia_doce_salgada", subcategory: "snacks_aperitivos" },
  { test: /chocolate|rebucado|goma|bombom/i, category: "mercearia_doce_salgada", subcategory: "chocolates_doces" },
  { test: /compota|doce|mel\b|marmelada|acucar|adocante/i, category: "mercearia_doce_salgada", subcategory: "compotas_mel" },

  // padaria_pastelaria
  { test: /croissant|folhado/i, category: "padaria_pastelaria", subcategory: "croissants_folhados" },
  { test: /torrada|tosta|gressino/i, category: "padaria_pastelaria", subcategory: "torradas_tostas" },
  { test: /bolo|pastelaria|pasteis|napolitana|queque/i, category: "padaria_pastelaria", subcategory: "bolos_pastelaria" },
  { test: new RegExp(`\\b(${altForms("pao")})\\b|padaria|wrap|tortilha`, "i"), category: "padaria_pastelaria", subcategory: "pao" },

  // congelados
  { test: /gelado/i, category: "congelados", subcategory: "gelados" },
  { test: /congelad.*legum|legum.*congelad|congelad.*vegetal|congelad.*fruta|fruta.*congelad/i, category: "congelados", subcategory: "vegetais_congelados" },
  { test: /congelad.*peixe|congelad.*marisco|peixe.*congelad|douradinho/i, category: "congelados", subcategory: "peixe_marisco_congelado" },
  { test: /congelad.*carne|carne.*congelad|hamburguer|almondega|nugget|crocante/i, category: "congelados", subcategory: "carne_congelada" },
  { test: /congelad.*massa|congelad.*pizza|pizza.*congelad|gnocchi/i, category: "congelados", subcategory: "massa_pizza_congelada" },
  { test: /prato.*pronto|refeicao.*pronta|salteado/i, category: "congelados", subcategory: "pratos_prontos_congelados" },

  // bebidas (baixo volume esperado nesta via - ver nota no topo do ficheiro)
  { test: /cerveja|sidra/i, category: "bebidas", subcategory: "cerveja" },
  { test: /vinho|champanhe|espumante/i, category: "bebidas", subcategory: "vinho" },
  { test: /espirituos|licor|whisky|vodka|gin\b|rum\b/i, category: "bebidas", subcategory: "bebidas_espirituosas" },
  { test: wordForm("agua"), category: "bebidas", subcategory: "agua" },
  { test: /sumo|refrigerante|nectar|isotonica|energetica/i, category: "bebidas", subcategory: "refrigerantes_sumos" },
  { test: /cafe|cha\b|infus/i, category: "bebidas", subcategory: "cafe_cha" },

  // higiene_pessoal_beleza
  { test: /cabelo|champo|shampoo/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_cabelo" },
  { test: /higiene oral|dentifrico|escova.*dente/i, category: "higiene_pessoal_beleza", subcategory: "higiene_oral" },
  { test: /higiene intima/i, category: "higiene_pessoal_beleza", subcategory: "higiene_intima" },
  { test: /desodorizante/i, category: "higiene_pessoal_beleza", subcategory: "desodorizantes" },
  { test: /depila/i, category: "higiene_pessoal_beleza", subcategory: "depilacao" },
  { test: /corpo|rosto|pele|creme|solar|banho|duche|sabonete|homem/i, category: "higiene_pessoal_beleza", subcategory: "cuidado_pele" },

  // bebe
  { test: /fralda/i, category: "bebe", subcategory: "fraldas" },
  { test: /leite.*bebe|leite.*infantil|papa\b|boiao|alimentacao infantil/i, category: "bebe", subcategory: "leite_po_boioes" },
  { test: /toalhita/i, category: "bebe", subcategory: "toalhitas" },
  { test: /bebe|infantil/i, category: "bebe", subcategory: "cuidado_bebe" },

  // casa_limpeza
  { test: /detergente.*roupa|roupa.*detergente|lavandaria/i, category: "casa_limpeza", subcategory: "detergente_roupa" },
  { test: /loica/i, category: "casa_limpeza", subcategory: "loica" },
  { test: /papel higienico|absorvente|toalhas.*papel|guardanapo/i, category: "casa_limpeza", subcategory: "papel_higienico_absorventes" },
  { test: /sacos.*lixo/i, category: "casa_limpeza", subcategory: "sacos_lixo" },
  { test: /limpeza|cuidados do lar|cozinha|casa de banho|chao|superficie|ambientador|inseticida/i, category: "casa_limpeza", subcategory: "limpeza_casa" },

  // animais_estimacao
  { test: new RegExp(`racao.*(${altForms("cao")})|comida.*(${altForms("cao")})|\\b(${altForms("cao")})\\b`, "i"), category: "animais_estimacao", subcategory: "racao_cao" },
  { test: new RegExp(`racao.*(${altForms("gato")})|comida.*(${altForms("gato")})|\\b(${altForms("gato")})\\b`, "i"), category: "animais_estimacao", subcategory: "racao_gato" },
  { test: /areia.*gato/i, category: "animais_estimacao", subcategory: "areia_gatos" },
  { test: /animais|animal/i, category: "animais_estimacao", subcategory: "acessorios_petiscos" },
];

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// crumbs: array de strings do breadcrumb (2-3 niveis tipico no Continente,
// ex. ["Frescos", "Legumes"] ou ["Laticínios e Ovos", "Leite"]).
export function classifyContinenteBreadcrumb(crumbs) {
  const breadcrumb = stripDiacritics((crumbs || []).filter(Boolean).join(" / "));
  if (!breadcrumb) return null;
  for (const rule of RULES) {
    if (rule.test.test(breadcrumb)) return { category: rule.category, subcategory: rule.subcategory };
  }
  return null;
}

export const OWN_BRAND_RE = /^(continente|da nossa pastelaria)/i;

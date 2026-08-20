// Normalizacao de marca: a mesma marca aparece escrita de formas diferentes
// entre lojas (maiusculas/minusculas, apostrofos, espacamento, acentos) -
// ex. "NESTLÉ" (Auchan) vs "Nestlé" (Continente/Pingo Doce). A regra
// automatica cobre ~90% dos casos (title-case quando a loja escreve tudo em
// maiusculas), mas ~79 grupos tinham diferenca real de pontuacao/espacos que
// precisa de mapeamento manual - aqui ficam os 76 confirmados (3 ficaram de
// fora por serem demasiado curtos/genericos para se ter confianca: "JP"/
// "J.P.", "CR&F"/"C.R.F.", "Do Brasil"/"DOBRASIL" - risco real de fundir
// marcas diferentes por coincidencia de texto).
//
// Chave: forma normalizada (lowercase, sem acentos, sem pontuacao/espacos) -
// gerada por normalizeBrandKey(). Valor: forma canonica a mostrar.

const CANONICAL_BRANDS = [
  "Mimosa", "Nivea", "Cem Porcento", "Nestlé", "L'Oréal Paris", "Margão",
  "Pantene", "Gullón", "Alpro", "Purina One", "Pescanova", "Nacional", "Iglo",
  "Dove", "Knorr", "Vileda", "Milka", "Lipton", "Colgate", "Salutem", "Dodot",
  "Delta", "Garnier", "Chicco", "Bribon", "Magnum", "Vitakraft", "Origens Bio",
  "Milaneza", "Renova", "Johnson's Baby", "Oral-B", "Air Wick", "Kellogg's",
  "Lay's", "L'Or", "H&S", "Dompé", "Carte D'Or", "Lily's Kitchen",
  "Scotch-Brite", "Dr. Oetker", "St. Dalfour", "GoGo Squeez", "McVitie's",
  "Ben & Jerry's", "M&M's", "Ach. Brito", "8in1", "Hellmann's", "Capri-Sun",
  "Jack Daniel's", "Reese's", "Ambi Pur", "PepeTed", "Dow's", "Grant's",
  "H. M. Borges", "Kit&Kin", "Moët & Chandon", "Mr. Cheese", "Dr. Beckmann",
  "Ballantine's", "Gordon's", "Hendrick's", "Fever-Tree", "Werther's",
  "Taylor's", "Fresh & Clean", "Full Protein", "Blandy's", "Nairn's",
  "Tesori D'Oriente", "Vive Soy", "Justino's", "Martha's", "Driscoll's",
  "St Michel", "Snatt's", "Carr's", "St Pierre", "Cuits", "Gibson's",
  "Solo Italia", "DemakUp", "Kh-7", "Dr Pepper", "D. Graça",
  "William Lawson's", "Piper-Heidsieck", "Martin Miller's", "Sheridan's",
  "Out!", "Dr. Bentes", "G'Vine", "Forno D'Oro", "Gold Strike",
  "Quinta dos Aciprestes", "Quinta de S. Francisco", "Quinta dos Carvalhais",
  "Innocent Maçã",
];

function normalizeBrandKey(brand) {
  return brand
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const BRAND_ALIAS_MAP = new Map(CANONICAL_BRANDS.map((b) => [normalizeBrandKey(b), b]));

// Devolve a forma canonica se a marca (normalizada) estiver mapeada, senao
// devolve o texto original tal como veio da loja.
export function normalizeBrand(brand) {
  if (!brand) return brand;
  const trimmed = brand.trim();
  if (!trimmed) return brand;
  const canonical = BRAND_ALIAS_MAP.get(normalizeBrandKey(trimmed));
  return canonical ?? trimmed;
}

// Sinonimos de pesquisa do retalho portugues - termos que os utilizadores
// usam de forma intercambiavel mas que nao batem certo numa pesquisa exata
// (nem com stemming do postgres, que so lida com flexao gramatical, nao com
// palavras diferentes para o mesmo conceito).
//
// Uso pretendido: no momento da pesquisa (nao no scraper) - expandir o termo
// pesquisado para todas as formas do grupo antes de consultar o
// search_vector/tsvector, para que pesquisar "sabao" tambem encontre
// produtos so com "detergente" no nome. Isto vive no lado da app (onde a
// pesquisa realmente acontece) - este ficheiro e so a lista de referencia,
// para ser portada/importada de la.
//
// Nao inclui "manteiga"/"margarina" (produtos diferentes, precos diferentes -
// nao se quer que apareçam juntos) nem "sumo"/"nectar" (sao legal e
// comercialmente distintos - sumo e 100% fruta, nectar e 25-50% - misturar
// arrisca poluir resultados de quem ja sabe a diferenca).

export const SEARCH_SYNONYM_GROUPS = [
  ["refrigerante", "sumo", "soda"],
  ["detergente", "sabão"],
  ["papel higiénico", "papel wc", "papel higienico"],
  ["iogurte", "yogurte", "yogurt"],
  ["batata frita", "chips", "batatas fritas"],
  ["azeite", "óleo de oliva"],
  ["fiambre", "presunto cozido"],
  ["natas", "creme de leite"],
  ["ketchup", "catchup"],
  ["esparguete", "spaghetti"],
  ["leite em pó", "leite em po"],
  ["gelado", "sorvete"],
  ["bolacha", "biscoito"],
  ["rebuçado", "caramelo"],
];

function normalize(term) {
  return term.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const SYNONYM_INDEX = new Map();
for (const group of SEARCH_SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_INDEX.set(normalize(term), group);
  }
}

// Devolve todas as formas equivalentes ao termo pesquisado (incluindo o
// proprio termo), ou so o termo original se nao pertencer a nenhum grupo.
export function expandSearchTerm(term) {
  const group = SYNONYM_INDEX.get(normalize(term));
  return group ?? [term];
}

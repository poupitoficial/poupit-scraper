// Extrai quantidade+unidade estruturada do nome de um produto (ex. "Leite
// Meio Gordo 1L" -> { value: 1000, unit: "ml" }), reutilizando a mesma regex
// e conversao para unidade-base ja validadas em scripts/matchLib.mjs. So
// devolve algo quando ha um numero+unidade explicito no nome - nunca usa o
// fallback "proxy" (price/pricePerUnit) daquele ficheiro, porque isso e uma
// estimativa valida so no contexto de comparar dois produtos entre si, nao
// um valor real para gravar persistentemente num produto individual.
//
// unit e sempre "g" ou "ml" (unidade-base, kg/L ja convertidos) - assim
// pesquisar "leite 1l" so precisa de converter 1l -> 1000 e comparar
// diretamente, sem ter de lidar com kg vs g / L vs ml em cada pesquisa.

const QTY_RE = /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b|(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/i;

// Intervalos de peso/volume usados como rotulo de tamanho, nao como
// quantidade do produto - ex. "Fraldas 9-15kg T4" (peso do bebe), "Racao Cao
// 10-25kg" (peso do animal-alvo), "Fraldas +15kg T7", "Fraldas <3kg T0". Sem
// isto, QTY_RE apanhava o numero final do intervalo como se fosse o peso da
// embalagem, criando falsos matches entre embalagens de tamanhos diferentes
// que partilham o mesmo rotulo de intervalo (bug real, ver auditoria de
// precos: 77 pares de fraldas emparelhados, 33 com spread de preco >50%).
const WEIGHT_RANGE_RE = /(?:\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?|[<>+]\s*\d+(?:[.,]\d+)?)\s*(?:kg|g|l|ml|cl)\b/gi;

function toBaseUnit(value, unit) {
  const v = Number(String(value).replace(",", "."));
  switch (unit.toLowerCase()) {
    case "kg":
      return { value: v * 1000, unit: "g" };
    case "g":
      return { value: v, unit: "g" };
    case "l":
      return { value: v * 1000, unit: "ml" };
    case "cl":
      return { value: v * 10, unit: "ml" };
    case "ml":
      return { value: v, unit: "ml" };
    default:
      return null;
  }
}

export function extractQuantity(name) {
  if (!name) return null;
  const m = name.replace(WEIGHT_RANGE_RE, " ").match(QTY_RE);
  if (!m) return null;
  if (m[1] && m[2] && m[3]) {
    const base = toBaseUnit(m[2], m[3]);
    if (!base) return null;
    return { value: base.value * Number(m[1]), unit: base.unit };
  }
  if (m[4] && m[5]) {
    return toBaseUnit(m[4], m[5]);
  }
  return null;
}

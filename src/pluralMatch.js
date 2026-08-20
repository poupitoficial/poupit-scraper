// Mecanismo generico de plural tolerante, usado pelos classificadores de
// breadcrumb (Auchan, Aldi, Continente). Os breadcrumbs dos sites usam quase
// sempre o plural do nome da seccao (ex. "Aguas", "Vegetais", "Caes"), mas
// comparar so a forma singular com fronteira de palavra falha sempre que o
// plural nao contem o singular como substring exata - acontece com plurais
// regulares em vogal+s tambem (\bfruta\b nao apanha "Frutas") e ainda mais
// com os irregulares portugueses (cao->caes, vegetal->vegetais, pao->paes).
// Em vez de acrescentar uma excecao a mao por palavra nova, gera-se as
// formas de plural (regular e as irregulares mais comuns) e aceita-se
// qualquer uma.
export function pluralForms(word) {
  const forms = new Set([word]);
  if (/ao$/.test(word)) {
    const stem = word.slice(0, -2);
    forms.add(stem + "oes");
    forms.add(stem + "aes");
    forms.add(stem + "aos");
  } else if (/[aeou]l$/.test(word)) {
    forms.add(word.slice(0, -1) + "is");
  } else if (/il$/.test(word)) {
    forms.add(word.slice(0, -2) + "is");
  } else if (/m$/.test(word)) {
    forms.add(word.slice(0, -1) + "ns");
  } else if (/[rz]$/.test(word)) {
    forms.add(word + "es");
  } else {
    forms.add(word + "s");
  }
  return [...forms];
}

export function wordForm(singular) {
  return new RegExp(`\\b(${pluralForms(singular).join("|")})\\b`, "i");
}

export function altForms(singular) {
  return pluralForms(singular).join("|");
}

// So grava uma nova linha em `prices` quando o preco realmente mudou desde a
// ultima vez, em vez de uma linha por produto por dia. O plano Free do Supabase
// tem limite de espaco (500 MB) e o historico de precos e o maior consumidor;
// isto reduz o crescimento da tabela para so os dias em que ha mudanca real.
export function priceChanged(previousPrice, newPrice) {
  if (previousPrice == null) return true; // primeira vez que vemos este produto
  // compara em centimos para evitar problemas de arredondamento de float
  return Math.round(previousPrice * 100) !== Math.round(newPrice * 100);
}

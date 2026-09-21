// Regras comuns de fim de corrida dos scrapers, para o CI (.github/workflows/
// scrape.yml) so ficar vermelho quando ha mesmo um problema.

// Numa corrida de 30000 pedidos ha sempre meia duzia de "fetch failed"
// transitorios. Antes, 1 so erro punha o job a falhar mesmo com 99.9% gravado,
// e o workflow ficava vermelho todos os dias - o que escondia as falhas reais.
// Agora falha se a taxa de erro passar SCRAPE_MAX_ERROR_RATE (5% por omissao),
// ou se nao houver produto nenhum (sitemap vazio, site em baixo, bloqueio).
export function setExitCodeFromErrors(errors, attempted) {
  const maxRate = Number(process.env.SCRAPE_MAX_ERROR_RATE ?? 0.05);
  if (attempted === 0) {
    console.error("Nenhum produto processado - a marcar a corrida como falhada.");
    process.exitCode = 1;
    return;
  }
  const rate = errors / attempted;
  const pct = (rate * 100).toFixed(2);
  if (rate > maxRate) {
    console.error(`Taxa de erro ${pct}% acima do limite de ${maxRate * 100}% - a marcar a corrida como falhada.`);
    process.exitCode = 1;
  } else if (errors > 0) {
    console.log(`${errors} erros (${pct}%), dentro do limite de ${maxRate * 100}%.`);
  }
}

// SCRAPE_TIME_BUDGET_MIN: para de pedir produtos novos a este tempo e termina
// normalmente (grava o que tem, sai com codigo 0), em vez de ser morto pelo
// timeout-minutes do GitHub a meio. Sem a env var, sem limite.
export function deadlineFromEnv() {
  const min = Number(process.env.SCRAPE_TIME_BUDGET_MIN);
  return Number.isFinite(min) && min > 0 ? Date.now() + min * 60_000 : null;
}

export function pastDeadline(deadline) {
  return deadline != null && Date.now() >= deadline;
}

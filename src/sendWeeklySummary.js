// Envia o "Resumo semanal" (push real, Expo Push API) — quanto a pessoa gastou/poupou nos
// cabazes concluídos nos últimos 7 dias. Antes disto o toggle "resumoSemanal" em Definições >
// Notificações gravava-se na base de dados mas nunca disparava nada, porque não havia histórico
// de cabaz nenhum no servidor (BasketHistoryContext.tsx só existia em memória no telemóvel).
//
// Corre com: node src/sendWeeklySummary.js
// Precisa de estar agendado 1x por semana (ex: segunda-feira de manhã) — este projeto não tem
// cron embutido, corre via task scheduler externo, tal como o sendPriceAlertNotifications.js.

import 'dotenv/config';
import { supabase } from './supabase.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const WINDOW_DAYS = 7;
// Evita reenviar se já houve um resumo_semanal nos últimos N dias (defende contra o script
// correr 2x na mesma semana por engano — não há coluna de "período" no notification_log, só se
// olha para created_at recente).
const DEDUPE_DAYS = 6;

async function sendPush(token, title, body, data) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
  });
  const json = await res.json();
  if (json.data?.status === 'error') {
    console.error(`  push falhou (${token.slice(0, 20)}...): ${json.data.message}`);
  }
}

function euro(v) {
  return `${v.toFixed(2).replace('.', ',')}€`;
}

async function run() {
  const windowCutoff = new Date();
  windowCutoff.setDate(windowCutoff.getDate() - WINDOW_DAYS);
  const dedupeCutoff = new Date();
  dedupeCutoff.setDate(dedupeCutoff.getDate() - DEDUPE_DAYS);

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,push_token,notification_prefs')
    .not('push_token', 'is', null);
  if (profilesError) throw profilesError;

  const eligible = (profiles ?? []).filter((p) => p.notification_prefs?.resumoSemanal);
  if (eligible.length === 0) {
    console.log('Sem utilizadores com push_token + resumoSemanal ligado — nada a fazer.');
    return;
  }

  const { data: recentLogs, error: logsError } = await supabase
    .from('notification_log')
    .select('user_id')
    .eq('kind', 'resumo_semanal')
    .gte('created_at', dedupeCutoff.toISOString());
  if (logsError) throw logsError;
  const alreadySent = new Set((recentLogs ?? []).map((r) => r.user_id));

  let sentCount = 0;
  for (const profile of eligible) {
    if (alreadySent.has(profile.id)) continue;

    const { data: entries, error: entriesError } = await supabase
      .from('basket_history')
      .select('total,savings')
      .eq('user_id', profile.id)
      .gte('created_at', windowCutoff.toISOString());
    if (entriesError) throw entriesError;
    if (!entries || entries.length === 0) continue;

    const totalSpent = entries.reduce((s, e) => s + Number(e.total), 0);
    const totalSaved = entries.reduce((s, e) => s + Number(e.savings), 0);

    const body =
      totalSaved > 0
        ? `Concluíste ${entries.length} cabaz${entries.length > 1 ? 'es' : ''} e poupaste ${euro(totalSaved)} esta semana.`
        : `Concluíste ${entries.length} cabaz${entries.length > 1 ? 'es' : ''} esta semana, no total de ${euro(totalSpent)}.`;

    await sendPush(profile.push_token, 'O teu resumo semanal 📊', body, { type: 'resumo_semanal' });
    await supabase.from('notification_log').insert({ user_id: profile.id, kind: 'resumo_semanal' });
    sentCount += 1;
  }

  console.log(`Resumos semanais enviados: ${sentCount}`);
}

run().catch((err) => {
  console.error('Falha a enviar resumo semanal:', err);
  process.exit(1);
});

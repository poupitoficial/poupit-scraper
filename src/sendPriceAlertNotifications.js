// Envia notificações push reais (Expo Push API) para descidas de preço em favoritos e alertas
// de preço-alvo atingido — corre depois de um scrape (preços atualizados em matched_prices).
// Sem isto, os toggles em "Definições > Notificações" da app ficavam gravados na base de dados
// mas nunca chegava nenhuma notificação a sério a ninguém.
//
// Mesma regra de disparo do ecrã de Alertas (src/screens/alerts/AlertsScreen.tsx,
// triggerThreshold) e dos Favoritos (FavoritesScreen.tsx, FAVORITE_DROP_THRESHOLD) — mantém os
// dois lados a concordar sobre quando é que uma descida "conta".
//
// Corre com: node src/sendPriceAlertNotifications.js
// Precisa de estar agendado a seguir a cada scrape (o teu agendador de scrape.js — este projeto
// não tem cron embutido, corre os scripts manualmente/via task scheduler externo).

import 'dotenv/config';
import { supabase } from './supabase.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const FAVORITE_DROP_THRESHOLD = 0.1;

function targetTriggerThreshold(referencePrice) {
  return referencePrice > 40 ? 0.03 : 0.05;
}

async function latestPriceByProduct(productIds) {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('matched_prices')
    .select('product_id,preco,data')
    .in('product_id', productIds)
    .order('data', { ascending: false });
  if (error) throw error;
  const cheapest = new Map();
  for (const row of data ?? []) {
    const current = cheapest.get(row.product_id);
    if (current == null || row.preco < current) cheapest.set(row.product_id, row.preco);
  }
  return cheapest;
}

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

async function run() {
  // Só utilizadores com token registado E o respetivo toggle ligado — o resto nem entra na conta.
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,push_token,notification_prefs')
    .not('push_token', 'is', null);
  if (profilesError) throw profilesError;
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  if (profileById.size === 0) {
    console.log('Sem utilizadores com push_token registado — nada a fazer.');
    return;
  }

  // --- Preço-alvo (price_alerts_matched) ---
  const { data: alerts, error: alertsError } = await supabase
    .from('price_alerts_matched')
    .select('user_id,matched_product_id,target_price')
    .eq('active', true)
    .not('target_price', 'is', null);
  if (alertsError) throw alertsError;

  const alertUserIds = [...new Set(alerts.map((a) => a.user_id))].filter((id) => {
    const p = profileById.get(id);
    return p?.notification_prefs?.precoAlvo;
  });
  const relevantAlerts = alerts.filter((a) => alertUserIds.includes(a.user_id));
  const alertPrices = await latestPriceByProduct([...new Set(relevantAlerts.map((a) => a.matched_product_id))]);

  let sentCount = 0;
  for (const alert of relevantAlerts) {
    const current = alertPrices.get(alert.matched_product_id);
    if (current == null) continue;
    const target = alert.target_price;
    if (!(target > current && (target - current) / target >= targetTriggerThreshold(target))) continue;

    const { data: existing } = await supabase
      .from('notification_log')
      .select('id,price_at_notification')
      .eq('user_id', alert.user_id)
      .eq('matched_product_id', alert.matched_product_id)
      .eq('kind', 'preco_alvo')
      .maybeSingle();
    // Já notificado a este preço (ou mais barato) — não repete a mesma descida.
    if (existing && existing.price_at_notification <= current) continue;

    const { data: product } = await supabase.from('matched_products').select('name').eq('id', alert.matched_product_id).maybeSingle();
    const token = profileById.get(alert.user_id).push_token;
    await sendPush(
      token,
      'O teu alerta de preço disparou 🎉',
      `${product?.name ?? 'Um produto'} chegou aos ${current.toFixed(2).replace('.', ',')}€ — abaixo do teu alvo.`,
      { type: 'preco_alvo', matchedProductId: alert.matched_product_id },
    );
    await supabase.from('notification_log').upsert(
      { user_id: alert.user_id, matched_product_id: alert.matched_product_id, kind: 'preco_alvo', price_at_notification: current },
      { onConflict: 'user_id,matched_product_id,kind' },
    );
    sentCount += 1;
  }

  // --- Descida em favoritos (favorites_matched, ≥10% desde que foi favoritado) ---
  const { data: favorites, error: favoritesError } = await supabase
    .from('favorites_matched')
    .select('user_id,matched_product_id,created_at');
  if (favoritesError) throw favoritesError;

  const favUserIds = [...new Set(favorites.map((f) => f.user_id))].filter((id) => profileById.get(id)?.notification_prefs?.descidaFavoritos);
  const relevantFavorites = favorites.filter((f) => favUserIds.includes(f.user_id));
  const favPrices = await latestPriceByProduct([...new Set(relevantFavorites.map((f) => f.matched_product_id))]);

  for (const fav of relevantFavorites) {
    const current = favPrices.get(fav.matched_product_id);
    if (current == null) continue;

    const sinceDate = fav.created_at.slice(0, 10);
    const { data: history } = await supabase
      .from('matched_prices')
      .select('preco,data')
      .eq('product_id', fav.matched_product_id)
      .gte('data', sinceDate);
    const baselinePrices = (history ?? []).map((h) => h.preco);
    if (baselinePrices.length === 0) continue;
    const baseline = Math.max(...baselinePrices);
    if (!(baseline > current && (baseline - current) / baseline >= FAVORITE_DROP_THRESHOLD)) continue;

    const { data: existing } = await supabase
      .from('notification_log')
      .select('id,price_at_notification')
      .eq('user_id', fav.user_id)
      .eq('matched_product_id', fav.matched_product_id)
      .eq('kind', 'descida_favorito')
      .maybeSingle();
    if (existing && existing.price_at_notification <= current) continue;

    const { data: product } = await supabase.from('matched_products').select('name').eq('id', fav.matched_product_id).maybeSingle();
    const token = profileById.get(fav.user_id).push_token;
    const pct = Math.round(((baseline - current) / baseline) * 100);
    await sendPush(
      token,
      'Um favorito teu baixou de preço 💚',
      `${product?.name ?? 'Um produto'} desceu ${pct}% desde que o guardaste.`,
      { type: 'descida_favorito', matchedProductId: fav.matched_product_id },
    );
    await supabase.from('notification_log').upsert(
      { user_id: fav.user_id, matched_product_id: fav.matched_product_id, kind: 'descida_favorito', price_at_notification: current },
      { onConflict: 'user_id,matched_product_id,kind' },
    );
    sentCount += 1;
  }

  console.log(`Notificações enviadas: ${sentCount}`);
}

run().catch((err) => {
  console.error('Falha a enviar notificações:', err);
  process.exit(1);
});

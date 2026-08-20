// Edge Function: apaga a conta auth.users do utilizador autenticado que chama isto.
// Precisa da service role key (nunca pode ir para a app cliente) — por isso corre aqui,
// no servidor, e não em src/screens/profile/DeleteAccountScreen.tsx.
//
// Deploy (Dashboard, sem precisar da CLI):
//   Supabase Dashboard -> Edge Functions -> Create a new function -> nome "delete-account"
//   -> cola este ficheiro -> Deploy.
// Ou via CLI, se tiveres `supabase login` feito:
//   supabase functions deploy delete-account
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY já vêm injetadas
// automaticamente pelo Supabase em todas as Edge Functions — não precisas de as configurar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Sem sessão' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Cliente com o JWT de quem chamou — só para confirmar quem é (nunca confiar num user_id
  // vindo do corpo do pedido, isso deixaria qualquer pessoa apagar a conta de outra).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida' }), { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY tem de estar definidos (ver .env.example)."
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

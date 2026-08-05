import "dotenv/config";
import { supabase } from "../src/supabase.js";

const tables = ["products", "prices", "supermarkets", "supermarket_products"];
for (const t of tables) {
  const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
  if (error) {
    console.log(t, "-> ERRO:", error.message);
  } else {
    console.log(t, "-> existe, linhas:", count);
  }
}

const { data: sample, error: sampleErr } = await supabase.from("products").select("*").limit(3);
console.log("\namostra products:", sampleErr ? sampleErr.message : JSON.stringify(sample, null, 2));

const { data: priceSample, error: priceErr } = await supabase.from("prices").select("*").limit(3);
console.log("\namostra prices:", priceErr ? priceErr.message : JSON.stringify(priceSample, null, 2));

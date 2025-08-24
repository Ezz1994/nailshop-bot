import { createClient } from "@supabase/supabase-js";

console.log("URL:", import.meta.env.VITE_SUPABASE_URL);
console.log("Key:", import.meta.env.VITE_SUPABASE_ANON_KEY);

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

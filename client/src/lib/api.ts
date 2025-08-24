import { supabase } from "@/lib/supabase";

export async function api(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();

  console.log("Access Token:", data.session?.access_token);
  const token = data.session?.access_token;

  return fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    credentials: "include",
  });
}

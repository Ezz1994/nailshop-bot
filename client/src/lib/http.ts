import axios, {
  type InternalAxiosRequestConfig,
  type AxiosRequestHeaders,
} from "axios";
import { supabase } from "@/lib/supabase";

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, ""); // e.g. http://localhost:8080/api

export const http = axios.create({
  baseURL: BASE,
  withCredentials: true,
});

// Attach Supabase JWT to every request
http.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  // Make sure headers is the right type
  const headers: AxiosRequestHeaders =
    (config.headers as AxiosRequestHeaders) ?? ({} as AxiosRequestHeaders);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  config.headers = headers;
  return config;
});

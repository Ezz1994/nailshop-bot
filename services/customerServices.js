// services/customerService.js
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getCustomerByPhone(phone) {
  const { data, error } = await supabase
    .from("customers").select("*").eq("phone", phone).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertCustomer({ phone, name, preferred_language = "en", name_ar = null }) {
  const { data, error } = await supabase
    .from("customers")
    .upsert({ phone, name, preferred_language, name_ar }, { onConflict: "phone" })
    .select("*").single();
  if (error) throw error;
  return data;
}

async function getLastBookingName(phone) {
  const { data, error } = await supabase
    .from("bookings")
    .select("customer_name, created_at")
    .eq("customer_phone", phone)
    .not("customer_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return data?.customer_name || null;
}

module.exports = { getCustomerByPhone, upsertCustomer, getLastBookingName };

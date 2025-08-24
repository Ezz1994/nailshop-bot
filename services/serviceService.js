// services/serviceService.js

const { createClient } = require("@supabase/supabase-js");

// Setup Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// List all active services (returns array of objects)
async function listServices() {
  const { data, error } = await supabase
    .from("services")
    .select(
      `
  service_id,
  name_en,
  name_ar,
  category,
  duration_min,
  price_jd,
  staff_level
`
    )
    .eq("is_active", true)
    .order("name_en");
  if (error) throw error;
  return data;
}

// Build allowed services text for chatbot
async function buildServiceMenuText() {
  const rows = await listServices();
  return "Allowed services:\n" + rows.map((r) => `- ${r.name_en}`).join("\n");
}

module.exports = {
  listServices,
  buildServiceMenuText,
};

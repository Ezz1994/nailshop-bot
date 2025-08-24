const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_KEY; // keep secret!

const supabaseAdmin = createClient(supabaseUrl, serviceKey);

module.exports = { supabaseAdmin };
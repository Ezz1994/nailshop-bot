// utils/requireAuth.js
const { supabaseAdmin } = require("./supabaseAdmin");

async function requireAuth(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Invalid token" });

  req.user = data.user; // { id, email, ... }
  next();
}

module.exports = { requireAuth };

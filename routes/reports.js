// routes/reports.js
require("dotenv").config();
const express = require("express");
const router = express.Router();

console.log(
  "[BOOT] ADMIN_API_KEY loaded:",
  (process.env.ADMIN_API_KEY || "").slice(0, 6) + "…"
);

const {
  sendDailyScheduleReport,
  sendYesterdaySummaryReport,
  sendWeeklySpotlightReport,
} = require("../services/reportServices");

// Simple header-based auth just for reports (no Supabase auth here)
function checkAdminApiKey(req, res, next) {
  const headerKey =
    (req.get("X-API-KEY") ||
      req.get("x-api-key") ||
      req.query.api_key ||
      "").trim();
  const envKey = (process.env.ADMIN_API_KEY || "").trim();

  console.log("[reports] headerKey len:", headerKey.length, "env len:", envKey.length);
  if (!headerKey || headerKey !== envKey) {
    return res.status(401).json({ error: "Bad or missing API key" });
  }
  next();
}

router.use(checkAdminApiKey);

// Simple ping to confirm auth works and handler wiring is fine
router.get("/ping", (_req, res) => {
  res.json({ ok: true, dryRun: process.env.REPORTS_DRY_RUN === "1" });
});

// TEST endpoints (wrap in try/catch and forward to error handler)
router.get("/test/daily", async (req, res, next) => {
  try {
    const which = req.query.which === "tomorrow" ? "tomorrow" : "today";
    await sendDailyScheduleReport(which);
    res.json({ ok: true, which });
  } catch (err) {
    next(err);
  }
});

router.get("/test/yesterday", async (_req, res, next) => {
  try {
    await sendYesterdaySummaryReport();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/test/weekly", async (req, res, next) => {
  try {
    const { start, end } = req.query; // optional ISO dates
    await sendWeeklySpotlightReport({ start, end });
    res.json({ ok: true, start, end });
  } catch (err) {
    next(err);
  }
});

// Centralized error handler so we don't see "[object Object]" anymore
router.use((err, _req, res, _next) => {
  const safe =
    err && err.message
      ? err.message
      : typeof err === "string"
      ? err
      : JSON.stringify(err);
  console.error("[reports] ERROR:", err);
  res.status(500).json({ error: safe });
});

module.exports = router;

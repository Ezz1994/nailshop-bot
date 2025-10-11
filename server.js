/* server.js – keeps the HTTP plumbing separate from the bot brain
   --------------------------------------------------------------
   1. Loads secrets from .env.
   2. Boots an Express server.
   3. Mounts the WhatsApp bot router at /webhook.
   4. Schedules daily/weekly reports.
   5. Listens on the port Render (or Heroku, Fly, etc.) gives us.
*/

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const path = require("path");
const cors = require("cors");

const whatsappRouter = require("./routes/whatsapp");
const bookingsRouter = require("./routes/bookings");
const serviceSerivecRouter = require("./routes/services");
const reportsRouter = require("./routes/reports");  // <-- ADD THIS

const { requireAuth } = require("./utils/requireAuth");

// 👉 import your report services
const {
  sendDailyScheduleReport,
  sendYesterdaySummaryReport,
  sendWeeklySpotlightReport,
} = require("./services/reportServices");

const app = express();
app.enable("trust proxy");

// Enable CORS for all routes
app.use(cors());

// Serve static files from React build
app.use(express.static(path.join(__dirname, "client/dist")));

// Twilio sends application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
// Just in case we POST JSON in future admin routes
app.use(bodyParser.json());

app.use("/reports", (req, _res, next) => {
  console.log(`[HIT] /reports ${req.method} ${req.originalUrl}`);
  next();
}, reportsRouter);   
// 👉 All WhatsApp traffic goes here
app.use( whatsappRouter);
app.use(requireAuth, bookingsRouter);
app.use(serviceSerivecRouter);

// Simple health check
app.get("/healthz", (req, res) => res.send("ok"));
app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

// ---- CRON JOBS for reporting ----

// Every day at 8am → send "today" schedule
cron.schedule("0 8 * * *", () => {
  sendDailyScheduleReport("today").catch(console.error);
});

// Every day at 19:00 (7pm) → send "tomorrow" schedule
cron.schedule("0 19 * * *", () => {
  sendDailyScheduleReport("tomorrow").catch(console.error);
});

// Every day at 21:00 (9pm) → send yesterday summary
cron.schedule("0 9 * * *", () => {
  sendYesterdaySummaryReport().catch(console.error);
});

// Every Sunday at 20:00 → send weekly spotlight
cron.schedule("0 20 * * 0", () => {
  sendWeeklySpotlightReport().catch(console.error);
});

// Catch-all handler: send back React's index.html file for SPA routing
// This MUST be the last route defined
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

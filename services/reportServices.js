// services/reportServices.js
require("dotenv").config();
const twilio = require("twilio");
const { DateTime } = require("luxon");
const { supabaseAdmin } = require("../utils/supabaseAdmin"); // <- already in your project

const TZ = process.env.REPORTS_TIMEZONE || "Asia/Amman";
const DEFAULT_APPT_MIN = Number(process.env.AVG_SERVICE_DURATION_MIN || 45);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 1);

/* ---------- helpers ---------- */

function toUTCISO(dtLuxon) {
  return dtLuxon.toUTC().toISO({ suppressMilliseconds: true });
}

function fmtHHmm(dtISO) {
  return DateTime.fromISO(dtISO).setZone(TZ).toFormat("HH:mm");
}

function fmtDay(dtLuxon) {
  return dtLuxon.setZone(TZ).toFormat("ccc d LLL");
}

async function fetchBookingsBetween(startLuxon, endLuxon, { excludeCancelled = true } = {}) {
  const startUTC = toUTCISO(startLuxon.startOf("day"));
  const endUTC   = toUTCISO(endLuxon.endOf("day"));

  let query = supabaseAdmin
    .from("bookings")
    .select("id, customer_phone, customer_name, status, start_at, created_at, modified_at")
    .gte("start_at", startUTC)
    .lte("start_at", endUTC)
    .order("start_at", { ascending: true });

  if (excludeCancelled) {
    query = query.neq("status", "cancelled");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/* ---------- WhatsApp sending ---------- */

async function sendWhatsAppText(to, body) {
  if (process.env.REPORTS_DRY_RUN === "1") {
    console.log("[DRY RUN] Would send to", to, "\n" + body);
    return;
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: "whatsapp:" + process.env.TWILIO_SANDBOX_NUMBER,
    to: "whatsapp:" + to,
    body,
  });
}

async function broadcast(body) {
  const list = (process.env.REPORTS_WHATSAPP_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) {
    console.warn("[reports] REPORTS_WHATSAPP_TO is empty; skipping send.");
    return;
  }
  for (const to of list) await sendWhatsAppText(to, body);
}

/* ---------- Reports ---------- */

async function sendDailyScheduleReport(which = "today") {
  const now = DateTime.now().setZone(TZ);
  const day  = which === "tomorrow" ? now.plus({ days: 1 }) : now;

  const rows = await fetchBookingsBetween(day, day, { excludeCancelled: false });

  const header = which === "tomorrow" ? "📅 Tomorrow's Schedule" : "📅 Today's Schedule";
  let body = `${header} – ${fmtDay(day)}\n(time, client, status)\n`;

  if (!rows.length) {
    body += "— No bookings —";
  } else {
    for (const b of rows) {
      const client = b.customer_name || b.customer_phone || "-";
      const line = `• ${fmtHHmm(b.start_at)}  ${client}  ${b.status || "-"}`;
      body += line + "\n";
    }
  }

  await broadcast(body.trim());
}

async function sendYesterdaySummaryReport() {
  const now = DateTime.now().setZone(TZ);
  const y = now.minus({ days: 1 });
  const start = y.startOf("day");
  const end   = y.endOf("day");

  // Bookings scheduled yesterday (not cancelled) – used for utilization calc
  const scheduled = await fetchBookingsBetween(y, y, { excludeCancelled: true });

  // Bookings created yesterday
  const { data: createdRows, error: createdErr } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .gte("created_at", toUTCISO(start))
    .lte("created_at", toUTCISO(end));
  if (createdErr) throw createdErr;

  // Cancellations “yesterday”: status=cancelled AND modified_at yesterday
  const { data: cancelledRows, error: cancelErr } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .eq("status", "cancelled")
    .gte("modified_at", toUTCISO(start))
    .lte("modified_at", toUTCISO(end));
  if (cancelErr) throw cancelErr;

  const madeCount = createdRows?.length || 0;
  const cancelCount = cancelledRows?.length || 0;
  const net = madeCount - cancelCount;

  // Simple utilization approximation (no durations table): assume DEFAULT_APPT_MIN
  const openMinutes = (() => {
    try {
      const bh = process.env.BUSINESS_HOURS_JSON ? JSON.parse(process.env.BUSINESS_HOURS_JSON) : null;
      if (!bh) return 0;
      const weekday = ["sun","mon","tue","wed","thu","fri","sat"][y.weekday % 7];
      const win = bh[weekday];
      if (!win || win.length !== 2) return 0;
      const [oh, om] = win[0].split(":").map(Number);
      const [ch, cm] = win[1].split(":").map(Number);
      const openDT = y.set({ hour: oh, minute: om, second: 0, millisecond: 0 });
      const closeDT = y.set({ hour: ch, minute: cm, second: 0, millisecond: 0 });
      const mins = Math.max(0, Math.round(closeDT.diff(openDT, "minutes").minutes));
      return mins * MAX_CONCURRENT;
    } catch {
      return 0;
    }
  })();

  const bookedMinutes = scheduled.length * DEFAULT_APPT_MIN;
  const utilization = openMinutes > 0 ? Math.round((bookedMinutes / openMinutes) * 100) : 0;

  const body = `📊 Daily Summary – ${fmtDay(y)}
Bookings made: ${madeCount}
Cancellations: ${cancelCount}
Net: ${net}
Revenue (JD): N/A
Utilization: ${utilization}%`;

  await broadcast(body);
}

async function sendWeeklySpotlightReport({ start, end } = {}) {
  const now = DateTime.now().setZone(TZ);
  const weekEndLux  = end ? DateTime.fromISO(end, { zone: TZ }) : now;
  const weekStartLux = start ? DateTime.fromISO(start, { zone: TZ }) : weekEndLux.minus({ days: 7 });

  const rows = await fetchBookingsBetween(weekStartLux, weekEndLux, { excludeCancelled: true });

  // Busiest hour block (HH:00) across the week
  const hourBuckets = new Map();
  for (const b of rows) {
    const key = DateTime.fromISO(b.start_at).setZone(TZ).toFormat("HH:00");
    hourBuckets.set(key, (hourBuckets.get(key) || 0) + 1);
  }
  let busiest = "-";
  if (hourBuckets.size) {
    busiest = [...hourBuckets.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const body = `🌟 Weekly Spotlight – ${fmtDay(weekStartLux)} → ${fmtDay(weekEndLux)}
Total bookings: ${rows.length}
Revenue (JD): N/A
Busiest hour: ${busiest}
Top services: N/A (no service table in current schema)`;

  await broadcast(body);
}

module.exports = {
  sendDailyScheduleReport,
  sendYesterdaySummaryReport,
  sendWeeklySpotlightReport,
};

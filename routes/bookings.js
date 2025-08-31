const express = require("express");
const router = express.Router();
const { getTodaysBookings } = require("../services/bookingService");
const { updateBooking } = require("../services/bookingService");
const { sendWhatsAppBookingUpdate } = require("../services/botService");
const { cancelBooking } = require("../services/bookingService");
const { getBookingsBetweenDates } = require("../services/bookingService");
const { makeBookingByServiceIds } = require("../services/bookingService");
const { getBookingDetails } = require("../services/bookingService");
const { getBookingsForJordanDay } = require("../services/bookingService");
const { DateTime } = require("luxon");

router.get("/api/bookings/today", async (req, res) => {
  try {
    const bookings = await getTodaysBookings();
    // Explicitly send status 200 with JSON
    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;
  const {
    start_at,
    end_at, // <-- ADDED THIS
    customer_phone, // This will be customer_phone in your DB <-- ADDED THIS
    customer_name, // <-- ADDED THIS
    // notes,
    // total_price, // <-- ADDED THIS
    // total_duration, // <-- ADDED THIS
    services,
  } = req.body;
  // ...extract whatever else you want to update...

  try {
    // You will need to update your updateBooking function
    // to accept and process these new fields.
    const updatedBooking = await updateBooking({
      id: bookingId,
      newStartISO: start_at,
      //   newEndISO: end_at, // Pass end_at
      newPhone: customer_phone, // Pass phone (customer_phone)
      newCustomerName: customer_name, // Pass customer_name
      //   newNotes: notes,
      //   newTotalPrice: total_price, // Pass total_price
      //   newTotalDuration: total_duration, // Pass total_duration
      newServices: services && services.map((s) => s.service_id), // Assuming this is how you update services
    });

    console.log("updatedBooking:", updatedBooking);

    await sendWhatsAppBookingUpdate(
      updatedBooking.customer_phone,
      updatedBooking
    );

    res.status(200).json({ booking: updatedBooking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/bookings/:id/cancel", async (req, res) => {
  const bookingId = req.params.id;
  try {
    await cancelBooking(bookingId);

    const booking = await getBookingDetails(bookingId);
    await sendWhatsAppBookingUpdate(booking.customer_phone, booking);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/bookings/range", async (req, res) => {
  // Expects start=YYYY-MM-DD, end=YYYY-MM-DD as query params
  const { start, end } = req.query;
  try {
    // You'll want a service method for this, eg:
    const bookings = await getBookingsBetweenDates(start, end);
    res.json({ bookings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/bookings", async (req, res) => {
  try {
    const { start_at, service_ids, customer_phone, customer_name, notes } =
      req.body;

    const booking = await makeBookingByServiceIds({
      startISO: start_at,
      serviceIds: service_ids,
      phone: customer_phone,
      name: customer_name,
      notes,
    });

    // Fetch booking details (so WhatsApp message includes services etc)
    const fullBooking = await getBookingDetails(booking.id);
    console.log("Sending WhatsApp", fullBooking.customer_phone, fullBooking);

    // Send WhatsApp notification
    await sendWhatsAppBookingUpdate(fullBooking.customer_phone, fullBooking);

    res.status(201).json({ booking: fullBooking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/api/bookings/day", async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
  }

  try {
    // Use the same helper with start = end = date
    const bookings = await getBookingsForJordanDay(date, date);
    res.json({ bookings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Read-only config + availability validation ----
const TIME_ZONE = "Asia/Amman";
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || "0");
const BUSINESS_HOURS = process.env.BUSINESS_HOURS_JSON
  ? JSON.parse(process.env.BUSINESS_HOURS_JSON)
  : null;

function getBusinessWindowFor(startISO) {
  if (!BUSINESS_HOURS)
    return { open: null, close: null, closed: false, key: null };
  const dt = DateTime.fromISO(startISO, { zone: TIME_ZONE });
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const key = keys[dt.weekday % 7];
  const win = BUSINESS_HOURS[key];
  if (!win || win.length !== 2)
    return { open: null, close: null, closed: true, key };
  return { open: win[0], close: win[1], closed: false, key };
}

function isWithinBusinessHours(startISO, durationMin = null) {
  const { open, close, closed } = getBusinessWindowFor(startISO);
  if (closed) return false;
  if (!open || !close) return true;
  const dt = DateTime.fromISO(startISO, { zone: TIME_ZONE });
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const openDT = dt.set({ hour: oh, minute: om, second: 0, millisecond: 0 });
  const closeDT = dt.set({ hour: ch, minute: cm, second: 0, millisecond: 0 });
  if (Number.isFinite(durationMin)) {
    const end = dt.plus({ minutes: durationMin });
    return dt >= openDT && end <= closeDT;
  }
  return dt >= openDT && dt < closeDT;
}

function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

function calcDurationFromBooking(b) {
  if (b.end_at) {
    const s = DateTime.fromISO(b.start_at).setZone(TIME_ZONE);
    const e = DateTime.fromISO(b.end_at).setZone(TIME_ZONE);
    const mins = Math.max(0, Math.round(e.diff(s, "minutes").minutes));
    if (mins) return mins;
  }
  if (Number.isFinite(b.total_duration) && b.total_duration > 0) return b.total_duration;
  const svcList = Array.isArray(b.services) ? b.services : Array.isArray(b.booking_services) ? b.booking_services : [];
  if (svcList.length) {
    const sum = svcList.reduce((acc, s) => {
      const d = s.service?.duration_min ?? s.duration_min ?? 0;
      return acc + (Number.isFinite(d) ? d : 0);
    }, 0);
    if (sum) return sum;
  }
  return 45;
}

async function countConcurrentAt(startISO, durationMin, { excludeId } = {}) {
  const start = DateTime.fromISO(startISO).setZone(TIME_ZONE);
  const end = start.plus({ minutes: durationMin });
  const dayStart = start.startOf("day").toISO();
  const dayEnd = start.endOf("day").toISO();

  let rows = [];
  try {
    rows = await getBookingsBetweenDates(dayStart, dayEnd);
  } catch (e) {
    console.error("getBookingsBetweenDates failed:", e.message);
    return 0;
  }

  const active = rows.filter(
    (b) => b && !["cancelled", "canceled"].includes(String(b.status || "").toLowerCase())
  );

  const count = active.filter((b) => {
    if (excludeId && b.id === excludeId) return false;
    const bs = DateTime.fromISO(b.start_at).setZone(TIME_ZONE);
    const be = b.end_at
      ? DateTime.fromISO(b.end_at).setZone(TIME_ZONE)
      : bs.plus({ minutes: calcDurationFromBooking(b) });
    return overlaps(start, end, bs, be);
  }).length;

  return count;
}

router.get("/api/config", (req, res) => {
  res.json({
    business_hours: BUSINESS_HOURS || null,
    max_concurrent: Number.isFinite(MAX_CONCURRENT) ? MAX_CONCURRENT : 0,
    time_zone: TIME_ZONE,
  });
});

router.get("/api/availability/check", async (req, res) => {
  try {
    const start = String(req.query.start || "");
    const durationMin = Number(req.query.durationMin || "0");
    const excludeId = req.query.excludeId ? String(req.query.excludeId) : undefined;

    if (!start || !Number.isFinite(durationMin) || durationMin <= 0) {
      return res.status(400).json({ ok: false, reason: "bad_input", message: "start and durationMin are required" });
    }

    const { closed, open, close } = getBusinessWindowFor(start);
    if (closed) {
      return res.json({
        ok: false,
        reason: "closed",
        message: "Selected day is closed.",
        window: open && close ? { open, close } : null,
      });
    }

    const within = isWithinBusinessHours(start, durationMin);
    if (!within) {
      return res.json({
        ok: false,
        reason: "outside_hours",
        message: "Selected time is outside business hours.",
        window: open && close ? { open, close } : null,
      });
    }

    if (Number.isFinite(MAX_CONCURRENT) && MAX_CONCURRENT > 0) {
      const current = await countConcurrentAt(start, durationMin, { excludeId });
      if (current >= MAX_CONCURRENT) {
        return res.json({
          ok: false,
          reason: "capacity",
          message: "This time exceeds the maximum concurrent bookings.",
          currentConcurrent: current,
          maxConcurrent: MAX_CONCURRENT,
          window: open && close ? { open, close } : null,
        });
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("availability/check error:", e);
    return res.status(500).json({ ok: false, reason: "server_error", message: "Failed to validate availability" });
  }
});
module.exports = router;

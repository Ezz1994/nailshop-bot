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
module.exports = router;

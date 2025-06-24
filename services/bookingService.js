// services/bookingService.js

const { createClient } = require("@supabase/supabase-js");
const { DateTime } = require("luxon");

// Setup Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TIME_ZONE = "Asia/Amman";

// Insert a new booking and associated services
async function makeBooking({ phone, names, startISO }) {
  const { data, error } = await supabase
    .from("bookings")
    .insert({ customer_phone: phone, start_at: startISO, status: "confirmed" })
    .select("id")
    .single();
  if (error) throw error;

  const { error: bsErr } = await supabase.rpc("insert_booking_services", {
    _booking_id: data.id,
    _service_names: names,
  });
  if (bsErr) throw bsErr;

  return data.id;
}

// Get all upcoming bookings for a phone number
async function upcomingBookings(phone) {
  const nowUTCMinus3 = DateTime.now().setZone("UTC-3").toISO();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, start_at, services:booking_services(name_en)")
    .eq("customer_phone", phone)
    .eq("status", "confirmed")
    .gte("start_at", nowUTCMinus3)
    .order("start_at");
  if (error) throw error;
  return data;
}

// Cancel a booking by ID
async function cancelBooking(id) {
  const { error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      modified_at: DateTime.now().setZone(TIME_ZONE).toISO(),
    })
    .eq("id", id);
  if (error) throw error;
}

// Get details for a specific booking (used for updates)
async function getBookingDetails(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, start_at, services:booking_services(name_en)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

// Update booking: time, services, or both
async function updateBooking({
  id,
  newStartISO = null,
  newServices = null,
}) {
  // Update booking table if date/time changed
  if (newStartISO) {
    const { error } = await supabase
      .from("bookings")
      .update({
        start_at: newStartISO,
        modified_at: DateTime.now().setZone(TIME_ZONE).toISO(),
      })
      .eq("id", id);
    if (error) {
      console.error("Error updating booking start_at:", error);
      throw error;
    }
  }

  // Update services if changed
  if (Array.isArray(newServices) && newServices.length > 0) {
    // Delete existing services
    const { error: delError } = await supabase
      .from("booking_services")
      .delete()
      .eq("booking_id", id);
    if (delError) {
      console.error("Error deleting old services:", delError);
      throw delError;
    }

    // Insert new services
    const { error: insError } = await supabase.rpc("insert_booking_services", {
      _booking_id: id,
      _service_names: newServices,
    });
    if (insError) {
      console.error("Error inserting new services:", insError);
      throw insError;
    }

    // If only services changed, still update modified_at
    if (!newStartISO) {
      const { error: modError } = await supabase
        .from("bookings")
        .update({ modified_at: DateTime.now().setZone(TIME_ZONE).toISO() })
        .eq("id", id);
      if (modError) {
        console.error("Error updating modified_at:", modError);
        throw modError;
      }
    }
  }
}

module.exports = {
  makeBooking,
  upcomingBookings,
  cancelBooking,
  getBookingDetails,
  updateBooking,
};

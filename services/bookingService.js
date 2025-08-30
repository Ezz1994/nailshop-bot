// services/bookingService.js

const { createClient } = require("@supabase/supabase-js");
const { DateTime } = require("luxon");
const {getJordanDayUtcRange} =require('../utils/time')
const { getCustomerByPhone } = require("./customerServices");

// Setup Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TIME_ZONE = "Asia/Amman";

// Insert a new booking and associated services
async function makeBooking({ phone, names, startISO }) {
  // snapshot English name from customers (if exists)
  let snapshotName = null;
  try { const c = await getCustomerByPhone(phone); snapshotName = c?.name || null; } catch {}

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      customer_phone: phone,
      customer_name: snapshotName, // English snapshot
      start_at: startISO,
      status: "confirmed",
    })
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
  const nowUtc = DateTime.now().toUTC().toISO();

  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      start_at,
      status,
      services:booking_services (
        service_id,
        name_en,
        name_ar,
        price_jd,
        service:services (
          name_en,
          name_ar
        )
      )
    `)
    .eq("customer_phone", phone)
    .eq("status", "confirmed")
    .gte("start_at", nowUtc)
    .order("start_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
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
    .select("*, services:booking_services(name_en)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function updateBooking({
  id,
  newStartISO = undefined,
  newEndISO = undefined,
  newPhone = undefined,
  newCustomerName = undefined,
  newNotes = undefined,
  newTotalPrice = undefined,
  newTotalDuration = undefined,
  newServices = undefined, // Array of service_id or undefined
}) {
  const updates = {};

  if (newStartISO !== undefined && newStartISO !== null)
    updates.start_at = newStartISO;
  if (newEndISO !== undefined && newEndISO !== null) updates.end_at = newEndISO;
  if (newPhone !== undefined && newPhone !== null)
    updates.customer_phone = newPhone;
  if (newCustomerName !== undefined && newCustomerName !== null)
    updates.customer_name = newCustomerName;
  if (newNotes !== undefined && newNotes !== null) updates.notes = newNotes;
  if (newTotalPrice !== undefined && newTotalPrice !== null)
    updates.total_price = newTotalPrice;
  if (newTotalDuration !== undefined && newTotalDuration !== null)
    updates.total_duration = newTotalDuration;
  updates.modified_at = DateTime.now().setZone(TIME_ZONE).toISO();

  // 1. Update bookings table if there are changes
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", id);
    if (error) throw error;
  }

  // 2. Update booking_services via the new RPC function if newServices is defined (even if empty)
  if (newServices !== undefined) {
    const { error: rpcError } = await supabase.rpc("replace_booking_services", {
      p_booking_id: id,
      p_service_ids: newServices, // Array of service_id
    });
    if (rpcError) throw rpcError;
  }

  // 3. Fetch fresh booking + joined services (with all service details for the UI)
  const { data: bookingRows, error: fetchError } = await supabase
    .from("bookings")
    .select(
      `
      *,
      services:booking_services (
        service_id,
        name_en,
        name_ar,
        category,
        duration_min,
        price_jd,
        staff_level
      )
    `
    )
    .eq("id", id)
    .limit(1);

  if (fetchError) throw fetchError;
  const updatedBooking = bookingRows && bookingRows[0];
  if (!updatedBooking) {
    throw new Error(`Booking with ID ${id} not found after update.`);
  }

  // 4. Return the updated booking (the 'services' array is now correct for your UI)
  return updatedBooking;
}

async function makeBookingByServiceIds({ startISO, serviceIds, phone, name, notes }) {
  let snapshotName = null;
  try { const c = await getCustomerByPhone(phone); snapshotName = c?.name || null; } catch {}

  const { data: inserted, error } = await supabase
    .from("bookings")
    .insert({
      start_at: startISO,
      customer_phone: phone,
      customer_name: snapshotName,  // English snapshot
      notes,
      status: "confirmed",
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: bsErr } = await supabase.rpc("insert_booking_services_by_ids", {
    _booking_id: inserted.id,
    _service_ids: serviceIds,
  });
  if (bsErr) throw bsErr;

  return inserted;
}


async function getTodaysBookings() {
  // 1. Get Jordan time "today" as ISO string (e.g. '2025-07-15')
  const jordanNow = DateTime.now().setZone("Asia/Amman");
  const todayIso = jordanNow.toISODate(); // e.g. '2025-07-15'
  
  // 2. Get UTC range for this Jordanian day
  const { start, end } = getJordanDayUtcRange(todayIso); // returns ISO strings in UTC
  
  // 3. Call Supabase function with start_utc, end_utc
  const { data, error } = await supabase.rpc(
    "get_bookings_with_services_between", // Use the new function name
    {
      start_utc: start,
      end_utc: end,
    }
  );

  if (error) {
    console.error("Error fetching today's bookings with services:", error);
    throw new Error(error.message);
  }

  // 4. No need to filter here, as the function already returns correct range
  return data ?? [];
}

async function getBookingsBetweenDates(startISO, endISO) {
  const jordanZone = "Asia/Amman";

  // Start of the start day in Jordan → UTC
  const utcStart = DateTime.fromISO(startISO, { zone: jordanZone })
    .startOf("day")
    .toUTC()
    .toISO({ suppressMilliseconds: true });

  // End of the end day in Jordan → UTC
  const utcEnd = DateTime.fromISO(endISO, { zone: jordanZone })
    .endOf("day")
    .toUTC()
    .toISO({ suppressMilliseconds: true });

  const { data, error } = await supabase
    .from("bookings")
    .select(`
      *,
      booking_services:booking_services (
        *,
        service:services ( service_id, name_en, name_ar, price_jd, duration_min, staff_level )
      )
    `)
    .gte("start_at", utcStart)
    .lte("start_at", utcEnd); // inclusive end is fine; use .lt if you prefer half-open ranges

  if (error) throw error;
  return data ?? [];
}

async function getBookingsForJordanDay(day) {
  const { start, end } = getJordanDayUtcRange(day); // day: 'YYYY-MM-DD' (Jordan local)
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      *,
      booking_services:booking_services (
        *,
        service:services ( service_id, name_en, name_ar, price_jd, duration_min, staff_level )
      )
    `)
    .gte("start_at", start)
    .lte("start_at", end);

  if (error) throw error;
  return data ?? [];
}
module.exports = {
  makeBooking,
  upcomingBookings,
  cancelBooking,
  getBookingDetails,
  updateBooking,
  getTodaysBookings,
  getBookingsBetweenDates,
  makeBookingByServiceIds,
  getBookingsForJordanDay
};

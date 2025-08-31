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

function _normName(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}
function _looksLikeUuid(v) {
  return typeof v === "string" && /^[0-9a-f-]{8,}$/i.test(v);
}
function _looksLikeNumeric(v) {
  return typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));
}

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
    .single();
  if (error) throw error;
  return data;
}

async function updateBooking({
  id,
  newStartISO,
  newEndISO,
  newPhone,
  newCustomerName,
  newNotes,
  newTotalPrice,
  newTotalDuration,
  newServices, // array of service IDs or EN/AR names; [] => clear all
}) {
  const t0 = Date.now();
  try {
    console.log("[updateBooking] ▶ start", {
      id,
      hasNewStartISO: newStartISO != null,
      hasNewEndISO: newEndISO != null,
      hasNewPhone: newPhone != null,
      hasNewCustomerName: newCustomerName != null,
      hasNewNotes: newNotes != null,
      hasNewTotalPrice: newTotalPrice != null,
      hasNewTotalDuration: newTotalDuration != null,
      hasNewServices: newServices !== undefined,
      newServicesPreview:
        Array.isArray(newServices) && newServices.length
          ? newServices.slice(0, 5)
          : newServices,
    });

    // --- 1) Update the bookings row ---
    const input = {
      newStartISO,
      newEndISO,
      newPhone,
      newCustomerName,
      newNotes,
      newTotalPrice,
      newTotalDuration,
    };

    const fieldMap = {
      newStartISO: "start_at",
      newEndISO: "end_at",
      newPhone: "customer_phone",
      newCustomerName: "customer_name",
      newNotes: "notes",
      newTotalPrice: "total_price",
      newTotalDuration: "total_duration",
    };

    const updates = { modified_at: DateTime.now().setZone(TIME_ZONE).toISO() };
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null) updates[fieldMap[k]] = v;
    }

    console.log("[updateBooking] computed updates:", updates);

    const tUpdate = Date.now();
    const { error: updateErr } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", id);
    if (updateErr) {
      console.error("[updateBooking] ❌ bookings update error:", updateErr);
      throw updateErr;
    }
    console.log(
      "[updateBooking] ✓ bookings row updated in",
      `${Date.now() - tUpdate}ms`
    );

    // --- 2) Replace booking services if requested ---
    if (newServices !== undefined) {
      const tSvc = Date.now();
      const requested = Array.isArray(newServices) ? newServices : [];

      console.log("[updateBooking] services update intent:", {
        booking_id: id,
        requested_count: requested.length,
        requested_preview: requested.slice(0, 10),
      });

      // Fetch once; build ID set + normalized name index
      const { data: all, error: svcErr } = await supabase
        .from("services")
        .select("service_id, name_en, name_ar");
      if (svcErr) {
        console.error("[updateBooking] ❌ fetch services error:", svcErr);
        throw svcErr;
      }
      console.log(
        "[updateBooking] services fetched:",
        (all || []).length,
        "rows"
      );

      const idSet = new Set((all || []).map((s) => String(s.service_id)));
      const nameIndex = new Map();
      for (const s of all || []) {
        const en = _normName(s.name_en || "");
        const ar = _normName(s.name_ar || "");
        if (en) nameIndex.set(en, s.service_id);
        if (ar) nameIndex.set(ar, s.service_id);
      }

      const resolved = [];
      const unresolved = [];

      for (const raw of requested) {
        const item = String(raw ?? "");
        if (idSet.has(item)) {
          resolved.push(item); // already a valid service_id
          continue;
        }
        const key = _normName(item); // try EN/AR name
        const sid = nameIndex.get(key);
        if (sid) {
          resolved.push(sid);
        } else {
          unresolved.push(item);
        }
      }

      console.log("[updateBooking] service resolution summary:", {
        requested_count: requested.length,
        resolved_count: resolved.length,
        resolved_ids_preview: resolved.slice(0, 10),
        unresolved_preview: unresolved.slice(0, 10),
      });

      if (requested.length > 0 && resolved.length === 0) {
        console.error(
          "[updateBooking] ❌ none of the requested services resolved; aborting"
        );
        throw new Error("No matching services found for provided names/ids.");
      }

      console.log("[updateBooking] ▶ calling replace_booking_services RPC", {
        booking_id: id,
        p_service_ids_len: resolved.length,
      });

      const tRpc = Date.now();
      const { error: rpcError } = await supabase.rpc(
        "replace_booking_services",
        {
          p_booking_id: id,
          p_service_ids: resolved, // may be empty: clears services
        }
      );
      if (rpcError) {
        console.error(
          "[updateBooking] ❌ replace_booking_services RPC error:",
          rpcError
        );
        throw rpcError;
      }
      console.log(
        "[updateBooking] ✓ replace_booking_services OK in",
        `${Date.now() - tRpc}ms (total service step ${Date.now() - tSvc}ms)`
      );

      // Optional verification read (best-effort)
      try {
        const { data: checkRows, error: checkErr } = await supabase
          .from("booking_services")
          .select("service_id")
          .eq("booking_id", id);
        if (checkErr) {
          console.warn(
            "[updateBooking] ⚠ post-RPC verification fetch error:",
            checkErr
          );
        } else {
          console.log(
            "[updateBooking] post-RPC booking_services:",
            (checkRows || []).map((r) => r.service_id)
          );
        }
      } catch (e) {
        console.warn(
          "[updateBooking] ⚠ post-RPC verification exception:",
          e?.message || e
        );
      }
    }

    // --- 3) Return the fresh booking with joined services for UI ---
    const tFetch = Date.now();
    const { data: updated, error: fetchErr } = await supabase
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
      .single();
    if (fetchErr) {
      console.error("[updateBooking] ❌ fetch updated booking error:", fetchErr);
      throw fetchErr;
    }
    if (!updated) {
      console.error("[updateBooking] ❌ booking not found after update:", id);
      throw new Error(`Booking with ID ${id} not found after update.`);
    }
    console.log(
      "[updateBooking] ✓ fetched updated booking in",
      `${Date.now() - tFetch}ms`
    );

    console.log(
      "[updateBooking] ✅ done in",
      `${Date.now() - t0}ms`,
      "booking_id=",
      id
    );
    return updated;
  } catch (err) {
    console.error("[updateBooking] ❌ failed", {
      booking_id: id,
      message: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
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

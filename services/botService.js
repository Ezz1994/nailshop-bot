require("dotenv").config();

const twilio = require("twilio");
const { DateTime } = require("luxon");
const {
  makeBooking,
  upcomingBookings,
  cancelBooking,
  updateBooking,
  getBookingDetails,
  getBookingsBetweenDates, // ← NEW import
} = require("./bookingService");

const { listServices, buildServiceMenuText } = require("./serviceService");
const {
  parseJordanDateTime,
  extractArabicDate,
  cleanArabicForDate,
} = require("../utils/time");
const { talkToGPT } = require("../utils/gptUtils");
const {
  transliterateArabicNameToEnglish,
  hasArabic,
  hasLatin,
  looksLikeName,
} = require("../utils/nameTransliteration");
const {
  getCustomerByPhone,
  upsertCustomer,
  getLastBookingName,
} = require("./customerServices");

// 0 = unlimited (disabled). Set MAX_CONCURRENT in .env to enable
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || "0");

// In-memory cache (optional, or move to cache.js)
const cache = new Map();

function markSelected(phone) {
  cache.set(`${phone}-selected`, true);
  cache.set(`${phone}-selectedAt`, Date.now());
}
function clearSelection(phone) {
  cache.delete(`${phone}-selected`);
  cache.delete(`${phone}-selectedAt`);
}

function toEnglishDigits(str = "") {
  return str.replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}
function isFreshSelection(phone, maxMs = 10 * 60 * 1000) {
  // 10 minutes default
  const sel = cache.get(`${phone}-selected`);
  const ts = cache.get(`${phone}-selectedAt`) || 0;
  return !!sel && Date.now() - ts <= maxMs;
}

const TIME_ZONE = "Asia/Amman";

const BUSINESS_HOURS = process.env.BUSINESS_HOURS_JSON
  ? JSON.parse(process.env.BUSINESS_HOURS_JSON)
  : null;

/**
 * Format a date string (ISO or JS Date) for WhatsApp replies.
 * Uses Arabic if lang === "ar".
 */
function formatWhatsAppDate(date, lang = "en") {
  if (!date) return lang === "ar" ? "غير معروف" : "Unknown";
  let dt =
    typeof date === "string"
      ? DateTime.fromISO(date)
      : DateTime.fromJSDate(date);
  dt = dt.setZone(TIME_ZONE);
  if (lang === "ar") {
    let str = dt.setLocale("ar").toFormat("cccc d LLL HH:mm");
    str = toArabicDigits(str);
    return str;
  }
  return dt.toFormat("ccc d LLL HH:mm");
}

function guessLang(text, prev = "en") {
  if (!text) return prev || "en";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[A-Za-z]/.test(text)) return "en";
  if (/(?:نعم|اي|أيوه|اها|تمام|لا|لأ)/i.test(text)) return "ar";
  if (/\b(?:yes|y|no|n)\b/i.test(text)) return "en";
  return prev || "en";
}

function renderServicesList(services, userLang) {
  return services
    .map((s) => {
      const nm =
        userLang === "ar"
          ? s.name_ar || s.name_en || ""
          : s.name_en || s.name_ar || "";
      const price =
        typeof s.price_jd === "number" || typeof s.price_jd === "string"
          ? ` – ${s.price_jd} JD`
          : "";
      let line = `• ${nm}${price}`;
      if (userLang === "ar") line = toArabicDigits(line);
      return line;
    })
    .join("\n");
}

function joinServiceNames(services = [], lang = "en") {
  if (!Array.isArray(services)) return "";
  const useAr = lang === "ar";
  return services
    .map((srv) =>
      useAr
        ? srv.service?.name_ar ||
          srv.name_ar ||
          srv.service?.name_en ||
          srv.name_en ||
          ""
        : srv.service?.name_en ||
          srv.name_en ||
          srv.service?.name_ar ||
          srv.name_ar ||
          ""
    )
    .filter(Boolean)
    .join(", ");
}

// Fallback month-word parser for phrases like "10 September 6 pm" or "10th of September at 6 pm"
function parseMonthWordFallback(text, existingISO = null) {
  const jordanZone = TIME_ZONE;
  const now = DateTime.now().setZone(jordanZone);
  const existingDt = existingISO
    ? DateTime.fromISO(existingISO, { zone: jordanZone })
    : null;

  let cleaned = String(text || "")
    .toLowerCase()
    .replace(/(\d)(am|pm)\b/gi, "$1 $2")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const m = cleaned.match(
    /(\d{1,2})\s+(?:of\s+)?([a-z]+)(?:\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const rawMonth = (m[2] || "").toLowerCase();
  const EN_MONTH = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  let key = rawMonth;
  if (!EN_MONTH[key] && key.length > 3) key = key.slice(0, 3);
  const month = EN_MONTH[key];
  if (!month) return null;

  const year = m[3] ? parseInt(m[3], 10) : now.year;

  let hour = existingDt ? existingDt.hour : 12;
  let minute = existingDt ? existingDt.minute : 0;
  if (m[4]) {
    hour = parseInt(m[4], 10);
    minute = m[5] ? parseInt(m[5], 10) : 0;
    const ap = (m[6] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  }

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: jordanZone }
  );
  return dt.toISO();
}

/**
 * Converts all Western digits in a string to Arabic-Indic digits.
 */
function toArabicDigits(str) {
  return str.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}
function sendReply(res, msg) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(msg);
  return res.type("text/xml").send(twiml.toString());
}

async function postNameResumeAfterFirstReply({
  originalMsg,
  fromPhone,
  userLang,
  displayName,
  res,
}) {
  // Thank them BY NAME in their language
  let thanks = BOT_MESSAGES.thanksNamePersonal[userLang](displayName);
  if (userLang === "ar") thanks = toArabicDigits(thanks);

  // If first message was a booking intent, try to auto-complete
  if (isBookIntent(originalMsg)) {
    const svcs = await listServices();
    const picked = findServiceByText(originalMsg, svcs, userLang);

    let cleaned = originalMsg;
    if (userLang === "ar") cleaned = cleanArabicForDate(originalMsg);
    const startISO =
      extractArabicDate(cleaned) ||
      parseJordanDateTime(cleaned, null, userLang) ||
      parseMonthWordFallback(cleaned, null);

    // A) Full booking in first message → confirm now
    if (picked && startISO) {
      const durationMin = picked.duration_min || 45;

      // Business-hours guard
      const winTxt = formatWindowForReply(startISO, userLang);
      const within = isWithinBusinessHours(startISO, durationMin);
      const { closed } = getBusinessWindowFor(startISO);

      if (closed) {
        let msg =
          `${thanks}\n\n` +
          BOT_MESSAGES.closedThatDay[userLang](dayLabel(startISO, userLang));
        if (userLang === "ar") msg = toArabicDigits(msg);
        return sendReply(res, msg);
      }
      if (!within) {
        let msg =
          `${thanks}\n\n` +
          BOT_MESSAGES.outsideBusinessHours[userLang](winTxt || "-");
        if (userLang === "ar") msg = toArabicDigits(msg);
        return sendReply(res, msg);
      }

      // Capacity guard
      const okCap = await guardMaxConcurrent(
        startISO,
        durationMin,
        userLang,
        res
      );
      if (!okCap) return;

      // Create booking
      const id = await makeBooking({
        phone: fromPhone,
        names: [picked.name_en], // EN for DB
        startISO,
        customerName: (await getCustomerByPhone(fromPhone))?.name || null,
      });

      // Confirmation text
      const svcTxt =
        userLang === "ar"
          ? picked.name_ar || picked.name_en
          : picked.name_en || picked.name_ar;
      const whenTxt = formatWhatsAppDate(startISO, userLang);

      let confirm =
        userLang === "ar"
          ? `✅ تم الحجز لـ ${svcTxt} – ${whenTxt}. رقمك: BR-${String(id).slice(
              0,
              6
            )}.`
          : `✅ Booked for ${svcTxt} – ${whenTxt}. Your ID: BR-${String(
              id
            ).slice(0, 6)}.`;

      if (userLang === "ar") confirm = toArabicDigits(confirm);
      return sendReply(res, `${thanks}\n\n${confirm}`);
    }

    // B1) They mentioned a service but no time → set stage=when and ask for time
    if (picked && !startISO) {
      cache.set(`${fromPhone}-mode`, "book");
      cache.set(`${fromPhone}-book-stage`, "when");
      cache.set(`${fromPhone}-svclist`, svcs);
      cache.set(`${fromPhone}-book-svc`, picked);

      const svcTxt =
        userLang === "ar"
          ? picked.name_ar || picked.name_en
          : picked.name_en || picked.name_ar;

      let msg = `${thanks}\n\n` + BOT_MESSAGES.bookingAskWhen[userLang](svcTxt);
      if (userLang === "ar") msg = toArabicDigits(msg);
      return sendReply(res, msg);
    }

    // B2) No service parsed yet → set stage=service and list services
    cache.set(`${fromPhone}-mode`, "book");
    cache.set(`${fromPhone}-book-stage`, "service");
    cache.set(`${fromPhone}-svclist`, svcs);

    const body = renderServicesList(svcs, userLang);
    let msg = `${thanks}\n\n` + BOT_MESSAGES.servicesHeader[userLang](body);
    if (userLang === "ar") msg = toArabicDigits(msg);
    return sendReply(res, msg);
  }

  // Not a booking intent → still start the booking flow with services
  const svcs = await listServices();
  cache.set(`${fromPhone}-mode`, "book");
  cache.set(`${fromPhone}-book-stage`, "service");
  cache.set(`${fromPhone}-svclist`, svcs);

  const body = renderServicesList(svcs, userLang);
  let msg = `${thanks}\n\n` + BOT_MESSAGES.servicesHeader[userLang](body);
  if (userLang === "ar") msg = toArabicDigits(msg);
  return sendReply(res, msg);
}

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

function formatWindowForReply(startISO, lang = "en") {
  const { open, close, closed } = getBusinessWindowFor(startISO);
  if (closed || !open || !close) return null;
  const s = `${open}–${close}`;
  return lang === "ar" ? toArabicDigits(s) : s;
}

function dayLabel(startISO, lang = "en") {
  const dt = DateTime.fromISO(startISO, { zone: TIME_ZONE });
  const fmt = lang === "ar" ? "cccc d LLL" : "ccc d LLL";
  const txt = dt.setLocale(lang === "ar" ? "ar" : "en").toFormat(fmt);
  return lang === "ar" ? toArabicDigits(txt) : txt;
}

function calcDurationFromBooking(b) {
  // 1) explicit end_at
  if (b.end_at) {
    const s = DateTime.fromISO(b.start_at).setZone(TIME_ZONE);
    const e = DateTime.fromISO(b.end_at).setZone(TIME_ZONE);
    const mins = Math.max(0, Math.round(e.diff(s, "minutes").minutes));
    if (mins) return mins;
  }
  // 2) total_duration if you store it
  if (Number.isFinite(b.total_duration) && b.total_duration > 0) {
    return b.total_duration;
  }
  // 3) sum services (either `services` or `booking_services`)
  if (Array.isArray(b.services) && b.services.length) {
    const sum = b.services.reduce((acc, s) => {
      const d = s.service?.duration_min ?? s.duration_min ?? 0;
      return acc + (Number.isFinite(d) ? d : 0);
    }, 0);
    if (sum) return sum;
  }
  if (Array.isArray(b.booking_services) && b.booking_services.length) {
    const sum = b.booking_services.reduce((acc, s) => {
      const d = s.service?.duration_min ?? s.duration_min ?? 0;
      return acc + (Number.isFinite(d) ? d : 0);
    }, 0);
    if (sum) return sum;
  }
  // fallback
  return 45;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Find the nearest free slots before/after the requested time.
// Keeps stepping by 30 minutes (configurable) within the SAME day & business hours.
async function findNearestAvailableSlots(
  startISO,
  durationMin,
  { excludeId } = {},
  stepMin = 30,
  maxHops = 48 // up to 24 steps (12 hours) each side
) {
  const center = DateTime.fromISO(startISO).setZone(TIME_ZONE);

  let beforeISO = null;
  let afterISO = null;

  const withinBH = (candISO) =>
    candISO &&
    isWithinBusinessHours(candISO, durationMin) &&
    DateTime.fromISO(candISO).setZone(TIME_ZONE).hasSame(center, "day");

  const check = async (candDT) => {
    const candISO = candDT.toISO();
    if (!withinBH(candISO)) return null;

    const cur = await countConcurrentAt(candISO, durationMin, { excludeId });
    if (
      !Number.isFinite(MAX_CONCURRENT) ||
      MAX_CONCURRENT < 1 ||
      cur < MAX_CONCURRENT
    ) {
      return candISO;
    }
    return null;
  };

  // Try exactly -30 and +30 first
  beforeISO = await check(center.minus({ minutes: stepMin }));
  afterISO = await check(center.plus({ minutes: stepMin }));

  // If one (or both) is still missing, keep stepping outward independently
  for (let hop = 2; hop <= maxHops && (!beforeISO || !afterISO); hop++) {
    if (!beforeISO) {
      beforeISO = await check(center.minus({ minutes: stepMin * hop }));
    }
    if (!afterISO) {
      afterISO = await check(center.plus({ minutes: stepMin * hop }));
    }
  }

  return { beforeISO, afterISO };
}

async function countConcurrentAt(startISO, durationMin, { excludeId } = {}) {
  const start = DateTime.fromISO(startISO).setZone(TIME_ZONE);
  const end = start.plus({ minutes: durationMin });

  // pull bookings for the same day (fast + enough to check overlaps)
  const dayStart = start.startOf("day").toISO();
  const dayEnd = start.endOf("day").toISO();

  let rows = [];
  try {
    rows = await getBookingsBetweenDates(dayStart, dayEnd);
  } catch (e) {
    console.error("getBookingsBetweenDates failed:", e.message);
    return 0; // fail-open if range fetch is not wired yet
  }

  const active = rows.filter(
    (b) =>
      b &&
      !["cancelled", "canceled"].includes(String(b.status || "").toLowerCase())
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
async function guardMaxConcurrent(
  startISO,
  durationMin,
  userLang,
  res,
  { excludeId, phone } = {}
) {
  if (!Number.isFinite(MAX_CONCURRENT) || MAX_CONCURRENT < 1) return true;

  const current = await countConcurrentAt(startISO, durationMin, { excludeId });
  if (current >= MAX_CONCURRENT) {
    const { beforeISO, afterISO } = await findNearestAvailableSlots(
      startISO,
      durationMin,
      { excludeId }
    );

    const fmtTime = (iso) => {
      const dt = DateTime.fromISO(iso).setZone(TIME_ZONE);
      let s = dt.setLocale(userLang === "ar" ? "ar" : "en").toFormat("HH:mm");
      return userLang === "ar" ? toArabicDigits(s) : s;
    };

    let msg = BOT_MESSAGES.fullyBooked[userLang];

    // Build suggestions (forward-only 30-min steps) and include existing nearest ones when relevant
    const suggestions = [];
    const suggestionIsos = [];

    // Forward-only probing: +30, +60, +90 within same day and business hours
    try {
      const center = DateTime.fromISO(startISO).setZone(TIME_ZONE);
      const stepMin = 30;
      for (let hop = 1; hop <= 6 && suggestions.length < 3; hop++) {
        const candDT = center.plus({ minutes: stepMin * hop });
        const candISO = candDT.toISO();
        const withinBH =
          isWithinBusinessHours(candISO, durationMin) &&
          candDT.hasSame(center, "day");
        if (!withinBH) continue;
        const cur = await countConcurrentAt(candISO, durationMin, {
          excludeId,
        });
        if (
          !Number.isFinite(MAX_CONCURRENT) ||
          MAX_CONCURRENT < 1 ||
          cur < MAX_CONCURRENT
        ) {
          suggestions.push(`• ${fmtTime(candISO)}`);
          suggestionIsos.push(candISO);
        }
      }
    } catch (e) {
      // If forward probing fails for any reason, fall back silently
    }

    // Fallback to existing nearest suggestions if forward set is empty
    if (suggestions.length === 0) {
      if (beforeISO) suggestions.push(`• ${fmtTime(beforeISO)}`);
      if (afterISO) suggestions.push(`• ${fmtTime(afterISO)}`);
    }

    if (suggestions.length > 0) {
      if (phone && suggestionIsos.length > 0) {
        // Offer first forward suggestion with yes/no flow
        const firstIso = suggestionIsos[0];
        const firstTime = fmtTime(firstIso);
        try {
          cache.set(`${phone}-suggest-iso`, firstIso);
          cache.set(`${phone}-suggest-duration`, durationMin);
        } catch {}
        const prompt =
          userLang === "ar"
            ? `\n\nعنا وقت متاح الساعة ${firstTime}. أأغير الحجز لهل وقت؟ (نعم / لا)`
            : `\n\nWe have a spot at ${firstTime}. Move your booking to this time? (yes / no)`;
        msg += prompt;
      } else {
        msg += `\n\n${BOT_MESSAGES.suggestIntro[userLang]}\n${suggestions.join(
          "\n"
        )}\n\n${BOT_MESSAGES.suggestCTA[userLang]}`;
      }
    }

    if (userLang === "ar") msg = toArabicDigits(msg);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(msg);
    res.type("text/xml").send(twiml.toString());
    return false;
  }
  return true;
}

// ---- Booking intent + helpers ----

const UPDATE_INTENT_EN = /\b(update|modify|change|reschedule|edit)\b/i;
const UPDATE_INTENT_AR =
  /(عدل|تعديل|أعدل|بدي\s*اعدل|حاب\s*اعدل|حابب\s*اعدل|غيّر|غير|أغير|ابغى\s*اعدل)/i;

const CANCEL_INTENT_EN = /\b(cancel|delete|remove)\b/i;
const CANCEL_INTENT_AR =
  /(الغاء|إلغاء|ألغي|الغي|ألغى|ألغيلي|بدي\s*الغي|حذف|احذف|شطب|شيل|شل|امسح)/i;

const BOOK_INTENT_EN =
  /\b(?:book|reserve|reservation|appointment|make (?:a )?booking)\b/i;
const BOOK_INTENT_AR =
  /(?:^|\s)(?:احجز(?:لي)?|(?:اريد|ابغى|بدي|حاب(?:ب)?)\s*حجز|موعد)(?=\s|$)/i;

function isBookIntent(text = "") {
  if (UPDATE_INTENT_EN.test(text) || UPDATE_INTENT_AR.test(text)) return false;
  if (CANCEL_INTENT_EN.test(text) || CANCEL_INTENT_AR.test(text)) return false;
  return BOOK_INTENT_EN.test(text) || BOOK_INTENT_AR.test(text);
}

function stripPunc(s = "") {
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .toLowerCase();
}

function findServiceByText(txt, svcs, lang = "en") {
  const q = stripPunc(txt);
  const n = parseInt(toEnglishDigits(txt).trim(), 10);
  if (!isNaN(n) && n >= 1 && n <= svcs.length) return svcs[n - 1];
  return svcs.find((s) => {
    const cand = [s.name_en || "", s.name_ar || ""].map(stripPunc);
    return cand.some((v) => v && (v === q || v.includes(q) || q.includes(v)));
  });
}

// --- WhatsApp notification sender ---
async function sendWhatsAppBookingUpdate(phone, booking, lang = "en") {
  if (!phone) return;
  if (booking.language && !lang) lang = booking.language;
  const L = lang === "ar" ? "ar" : "en";

  const time = booking.start_at
    ? formatWhatsAppDate(booking.start_at, L)
    : NOTIFY_MESSAGES.unknown[L];

  const serviceNames = Array.isArray(booking.services)
    ? booking.services
        .map((s) =>
          L === "ar"
            ? s.service?.name_ar ||
              s.name_ar ||
              s.service?.name_en ||
              s.name_en ||
              ""
            : s.service?.name_en ||
              s.name_en ||
              s.service?.name_ar ||
              s.name_ar ||
              ""
        )
        .join(", ")
    : NOTIFY_MESSAGES.unknown[L];

  const notes = booking.notes || NOTIFY_MESSAGES.none[L];

  let msgBuilder;
  if (booking.status === "cancelled" || booking.status === "canceled") {
    msgBuilder = NOTIFY_MESSAGES.cancelled[L];
  } else if (booking.status === "confirmed") {
    msgBuilder = NOTIFY_MESSAGES.confirmed[L];
  } else {
    const statusLabel =
      L === "ar"
        ? booking.status === "pending"
          ? "قيد الانتظار"
          : booking.status
        : booking.status.charAt(0).toUpperCase() + booking.status.slice(1);
    msgBuilder = ({ service, time, notes }) =>
      NOTIFY_MESSAGES.updated[L]({ service, time, status: statusLabel, notes });
  }

  let msg = msgBuilder({
    service: serviceNames,
    time,
    status:
      booking.status === "pending" && L === "ar"
        ? "قيد الانتظار"
        : booking.status.charAt
        ? booking.status.charAt(0).toUpperCase() + booking.status.slice(1)
        : booking.status,
    notes,
  });

  if (L === "ar") msg = toArabicDigits(msg);

  try {
    await twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    ).messages.create({
      from: "whatsapp:" + process.env.TWILIO_SANDBOX_NUMBER,
      to: "whatsapp:" + phone,
      body: msg,
    });
    console.log("WhatsApp update sent:", phone, msg);
  } catch (e) {
    console.error("Failed to send WhatsApp update:", e.message);
  }
}

// --- Multi-language message templates for chatbot replies ---
const BOT_MESSAGES = {
  firstTimeWelcomeGuide: {
    en: `Welcome! 👋 I'm your assistant.
Type "I want to book" to start a new booking.
Type "I want to update" to modify an existing booking.
Type "I want to cancel" to cancel a booking.

مرحبًا! 👋 أنا مساعدك.
إذا كتبت «أريد الحجز» سيبدأ الحجز.
إذا كتبت «أريد التحديث» سيبدأ التحديث.
إذا كتبت «أريد الإلغاء» سيبدأ الإلغاء.`,
    ar: `Welcome! 👋 I'm your assistant.
Type "I want to book" to start a new booking.
Type "I want to update" to modify an existing booking.
Type "I want to cancel" to cancel a booking.

مرحبًا! 👋 أنا مساعدك.
إذا كتبت «أريد الحجز» سيبدأ الحجز.
إذا كتبت «أريد التحديث» سيبدأ التحديث.
إذا كتبت «أريد الإلغاء» سيبدأ الإلغاء.`,
  },
  fallback: {
    en: "Sorry, I'm not sure how to help with that yet.",
    ar: "آسف، مش متأكد كيف أقدر أساعدك بهالشغلة.",
  },
  suggestIntro: {
    en: "Here are the nearest available times:",
    ar: "هاي أقرب الأوقات المتاحة:",
  },
  suggestCTA: {
    en: "Reply with your preferred time.",
    ar: "رد بالوقت اللي بناسبك.",
  },
  fullyBooked: {
    en: "⛔ Sorry, that time is fully booked. Please choose another time.",
    ar: "⛔ عذراً، هذا الوقت محجوز بالكامل. اختار وقت تاني لو سمحت.",
  },
  ok: {
    en: "Okay, your booking remains unchanged 👍",
    ar: "تمام، حجزك زي ما هو 👍",
  },
  noBookingsToCancel: {
    en: "😶‍🌫️ You have no upcoming bookings to cancel.",
    ar: "😶‍🌫️ ما عندك حجوزات حالياً لإلغاءها.",
  },
  noBookings: {
    en: "😶‍🌫️ You have no upcoming bookings.",
    ar: "😶‍🌫️ ما عندك حجوزات حالياً.",
  },
  oneBookingCancel: {
    en: (svcNames, when) =>
      `You have one booking: ${svcNames} on ${when}. Cancel it? (yes / no)`,
    ar: (svcNames, when) =>
      `عندك حجز واحد: ${svcNames} يوم ${when}. بدك تلغيه؟ (نعم / لا)`,
  },
  whichBookingToCancel: {
    en: (listTxt) =>
      `Which booking do you want to cancel? Reply with a number:\n${listTxt}`,
    ar: (listTxt) => `أي حجز بدك تلغي؟ رد برقم الحجز:\n${listTxt}`,
  },
  cancelDone: {
    en: "🗑️ Cancelled! Hope to see you another time.",
    ar: "🗑️ تم الإلغاء! بنشوفك المرة الجاية.",
  },
  cancelAllDone: {
    en: (count) => `🗑️ All ${count} bookings cancelled.`,
    ar: (count) => `🗑️ تم إلغاء كل الحجوزات (${count}).`,
  },
  cancelSomeDone: {
    en: (list) => `🗑️ Cancelled bookings: ${list}.`,
    ar: (list) => `🗑️ تم إلغاء الحجوزات: ${list}.`,
  },
  unknownBookingNumber: {
    en: "I couldn't find that booking number.",
    ar: "ما قدرت ألاقي رقم الحجز هذا.",
  },
  updateWhat: {
    en: "What would you like to update? You can say:\n• 'Change time to 3pm'\n• 'Move to tomorrow'\n• 'Change service to pedicure'\n• Or tell me the new time and service together",
    ar: "شو حابب تعدل؟ ممكن تقول:\n• 'غيّر الوقت للساعة 3'\n• 'أجّلها لبكرا'\n• 'غيّر الخدمة لبديكير'\n• أو اكتب الوقت والخدمة مع بعض",
  },
  updateWhatAfterSelect: {
    en: "Great! What would you like to update? You can say:\n• 'Change time to 3pm'\n• 'Move to tomorrow'\n• 'Change service to pedicure'\n• Or tell me the new time and service together",
    ar: "تمام! شو بدك تعدل؟\n• 'غيّر الوقت للساعة 3'\n• 'أجّلها لبكرا'\n• 'غيّر الخدمة لبديكير'\n• أو اكتب الوقت والخدمة مع بعض",
  },
  foundOneUpdate: {
    en: (svcNames, when) =>
      `I found your booking: ${svcNames} on ${when}.\nWhat would you like to update? You can say:\n• 'Change time to 3pm'\n• 'Move to tomorrow'\n• 'Change service to pedicure'\n• Or tell me the new time and service together`,
    ar: (svcNames, when) =>
      `لقيت حجزك: ${svcNames} يوم ${when}.\nشو بدك تعدل؟\n• 'غيّر الوقت للساعة 3'\n• 'أجّلها لبكرا'\n• 'غيّر الخدمة لبديكير'\n• أو اكتب الوقت والخدمة مع بعض`,
  },
  foundOneCancel: {
    en: (svcNames, when) =>
      `I found one: ${svcNames} on ${when}. Cancel it? (yes / no)`,
    ar: (svcNames, when) =>
      `لقيت حجز واحد: ${svcNames} يوم ${when}. بدك تلغيه؟ (نعم / لا)`,
  },
  askName: {
    en: "I don't have your name yet — what should I call you?",
    ar: "مرحباً! لسه ما عندي اسمك — شو اسمك الكريم؟",
  },
  thanksNamePersonal: {
    en: (n) => `Thanks, ${n}! Your name is saved.`,
    ar: (n) => `شكراً يا ${n}! تم حفظ الاسم.`,
  },
  whichBookingToUpdate: {
    en: (listTxt) =>
      `Which booking do you want to update? Reply with a number:\n${listTxt}`,
    ar: (listTxt) => `أي حجز بدك تعدل؟ رد برقم الحجز:\n${listTxt}`,
  },
  dateParseFail: {
    en: "Sorry, I couldn't parse that date/time. Try something like 'tomorrow 3pm' or 'Monday 5pm'.",
    ar: "آسف، ما قدرت أفهم التاريخ/الوقت. جرّب تكتب زي: 'بكرا 3 العصر' أو 'الإثنين 5'.",
  },
  updateError: {
    en: "Sorry, there was an error updating your booking. Please try again.",
    ar: "آسف، صار خطأ وإحنا بنعدّل حجزك. جرّب كمان مرة.",
  },
  updatePrefix: { en: "🔄 Updated your booking!", ar: "🔄 تم تعديل حجزك!" },
  updateNewTime: {
    en: (t) => ` New time: ${t}`,
    ar: (t) => ` الوقت الجديد: ${t}`,
  },
  updateNewServices: {
    en: (svcs) => ` New services: ${svcs}`,
    ar: (svcs) => ` الخدمات الجديدة: ${svcs}`,
  },
  anythingElse: {
    en: "\n\nLet me know if there's anything else!",
    ar: "\n\nخبرني إذا بدك أي إشي ثاني!",
  },
  servicesHeader: {
    en: (svcList) => `Here's what we offer:\n${svcList}`,
    ar: (svcList) => `هاي خدماتنا:\n${svcList}`,
  },
  bookingWhichService: {
    en: "Great! Which service would you like? Reply with a number or name:",
    ar: "تمام! أي خدمة بدك؟ رد برقمها أو باسمها:",
  },
  bookingAskWhen: {
    en: (svc) =>
      `Got it: ${svc}. When would you like it? (e.g., "Tue 5pm" / "tomorrow 3")`,
    ar: (svc) =>
      `تمام: ${svc}. إمتى بتحب الموعد؟ (مثلاً: "الثلاثاء ٥" أو "بكرا ٣")`,
  },
  bookingDateFail: {
    en: "Sorry, I couldn't understand the date/time. Please send day & time together (e.g., Tue 5pm).",
    ar: "آسف، ما قدرت أفهم التاريخ/الوقت. ابعت اليوم والوقت مع بعض (مثلاً: الثلاثاء ٥).",
  },
  bookedId: {
    en: (id) => `✅ Booked! Your ID is BR-${id}.`,
    ar: (id) => `✅ تم الحجز! رقمك: BR-${id}.`,
  },
  outsideBusinessHours: {
    en: (windowTxt) =>
      `⏰ That time is outside our opening hours (${windowTxt}). Please send another time within opening hours.`,
    ar: (windowTxt) =>
      `⏰ الوقت خارج أوقات الدوام (${windowTxt}). ابعت وقت ضمن أوقات الدوام.`,
  },
  closedThatDay: {
    en: (dayTxt) => `⏰ We're closed on ${dayTxt}. Please pick another day.`,
    ar: (dayTxt) => `⏰ إحنا مسكّرين يوم ${dayTxt}. اختار يوم تاني لو سمحت.`,
  },
};

const NOTIFY_MESSAGES = {
  confirmed: {
    en: ({ service, time, notes }) =>
      `✅ Your booking has been confirmed!\n\nService: ${service}\nTime: ${time}\nStatus: Confirmed\nNotes: ${notes}`,
    ar: ({ service, time, notes }) =>
      `✅ تم تأكيد حجزك!\n\nالخدمة: ${service}\nالموعد: ${time}\nالحالة: مؤكد\nملاحظات: ${notes}`,
  },
  cancelled: {
    en: ({ service, time, notes }) =>
      `❌ Your booking has been cancelled.\n\nService: ${service}\nTime: ${time}\nStatus: Cancelled\nNotes: ${notes}`,
    ar: ({ service, time, notes }) =>
      `❌ تم إلغاء حجزك.\n\nالخدمة: ${service}\nالموعد: ${time}\nالحالة: ملغي\nملاحظات: ${notes}`,
  },
  updated: {
    en: ({ service, time, status, notes }) =>
      `🔄 Your booking has been updated!\n\nService: ${service}\nTime: ${time}\nStatus: ${status}\nNotes: ${notes}`,
    ar: ({ service, time, status, notes }) =>
      `🔄 تم تعديل حجزك!\n\nالخدمة: ${service}\nالموعد: ${time}\nالحالة: ${status}\nملاحظات: ${notes}`,
  },
  unknown: { en: "Unknown", ar: "غير معروف" },
  none: { en: "-", ar: "-" },
};

// Main Express handler for incoming WhatsApp webhook POST
async function handleIncomingMessage(req, res) {
  const sig = req.headers["x-twilio-signature"];
  if (sig) {
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const ok = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      sig,
      url,
      req.body
    );
    if (!ok) return res.status(403).send("Invalid signature");
  }

  let incomingMsg = (req.body.Body || "").trim();

  const fromPhone = (req.body.From || "").replace("whatsapp:", "");

  const prevLang = cache.get(`${fromPhone}-lang`) || "en";
  const userLang = guessLang(incomingMsg, prevLang);
  cache.set(`${fromPhone}-lang`, userLang);

  // === CUSTOMER NAME CAPTURE (first-time only) ===
  const awaitingKey = `${fromPhone}-awaitingName`;
  const resumeKey = `${fromPhone}-resumeMsg`;

  // 1) Do we already know this customer?
  let customerRow = null;
  try {
    customerRow = await getCustomerByPhone(fromPhone);
  } catch {}
  if (!customerRow) {
    // Optional: prefill from the latest booking snapshot if any (legacy users)
    try {
      const last = await getLastBookingName(fromPhone);
      if (last) {
        customerRow = await upsertCustomer({
          phone: fromPhone,
          name: last, // assumed EN snapshot
          preferred_language: userLang === "ar" ? "ar" : "en",
        });
      }
    } catch {}
  }

  // 2) If still unknown and not already asking → show welcome guide first, then ask for name
  if (!customerRow && !cache.get(awaitingKey)) {
    // Check if this is the very first time this user is interacting
    const welcomeSentKey = `${fromPhone}-welcomeSent`;
    if (!cache.get(welcomeSentKey)) {
      // Mark welcome as sent to avoid showing it again
      cache.set(welcomeSentKey, true);

      // Send welcome guide message first
      let welcomeMsg = BOT_MESSAGES.firstTimeWelcomeGuide[userLang];
      if (userLang === "ar") welcomeMsg = toArabicDigits(welcomeMsg);

      // Set up name asking flow
      cache.set(awaitingKey, true);
      cache.set(resumeKey, incomingMsg);

      let ask = BOT_MESSAGES.askName[userLang];
      if (userLang === "ar") ask = toArabicDigits(ask);

      // Combine welcome + name ask in single message
      const combinedMsg = `${welcomeMsg}\n\n${ask}`;
      return sendReply(res, combinedMsg);
    }

    // If welcome was already sent but still no customer, just ask for name
    cache.set(awaitingKey, true);
    cache.set(resumeKey, incomingMsg);

    let ask = BOT_MESSAGES.askName[userLang];
    if (userLang === "ar") ask = toArabicDigits(ask);
    return sendReply(res, ask);
  }

  // 3) We are waiting for the user's name now
  if (!customerRow && cache.get(awaitingKey)) {
    const nameText = incomingMsg.trim();

    if (!looksLikeName(nameText)) {
      const again =
        userLang === "ar"
          ? "الاسم مش واضح. اكتب اسمك الأول والأخير لو سمحت."
          : "That doesn't look like a name. Please send your first and last name.";
      return sendReply(res, userLang === "ar" ? toArabicDigits(again) : again);
    }

    // Derive canonical English + keep Arabic if provided
    let canonicalEn = null;
    let nameArToSave = null;

    if (
      process.env.AUTO_TRANSLITERATE_NAMES === "1" &&
      hasArabic(nameText) &&
      !hasLatin(nameText)
    ) {
      const result = await transliterateArabicNameToEnglish(nameText);
      console.log("[NAME_TRANSLIT]", {
        phone: fromPhone,
        input: nameText,
        output: result?.nameEn,
        conf: result?.confidence,
      });
      if (result?.nameEn && result.confidence >= 0.75) {
        canonicalEn = result.nameEn; // EN for UI & bookings
        nameArToSave = nameText; // preserve Arabic original
      }
    }

    // If not Arabic-only or transliteration failed → use what they sent
    if (!canonicalEn) {
      canonicalEn = nameText; // may already be EN/mixed
      if (hasArabic(nameText)) nameArToSave = nameText;
    }

    // Save customer
    await upsertCustomer({
      phone: fromPhone,
      name: canonicalEn, // EN canonical
      preferred_language: userLang === "ar" ? "ar" : "en",
      name_ar: nameArToSave,
    });

    // THANK THEM BY NAME using the SAME ANSWERED LANGUAGE:
    // If they typed Arabic → display the Arabic they typed; else use English.
    const displayName = hasArabic(nameText) ? nameText : canonicalEn;

    // Resume using the original message that triggered the name ask
    const original = cache.get(resumeKey) || "";
    cache.delete(awaitingKey);
    cache.delete(resumeKey);

    return postNameResumeAfterFirstReply({
      originalMsg: original,
      fromPhone,
      userLang,
      displayName,
      res,
    });
  }

  if (
    /\b(list|show)\s+(?:the\s+)?services?\b/i.test(incomingMsg) ||
    /(الخدمات|قائمة\s+الخدمات|اعرض\s+الخدمات|بدي\s+اشوف\s+الخدمات|شو\s+الخدمات|شو\s+بتقدموا|شو\s+بتعملوا|الأسعار|قائمة\s+الأسعار)/i.test(
      incomingMsg
    )
  ) {
    const svcs = await listServices();
    const body = renderServicesList(svcs, userLang);
    let msg = BOT_MESSAGES.servicesHeader[userLang](body);
    if (userLang === "ar") msg = toArabicDigits(msg);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }

  // --- BOOK intent (instant) ---
  if (
    isBookIntent(incomingMsg) &&
    !UPDATE_INTENT_EN.test(incomingMsg) &&
    !UPDATE_INTENT_AR.test(incomingMsg) &&
    !CANCEL_INTENT_EN.test(incomingMsg) &&
    !CANCEL_INTENT_AR.test(incomingMsg)
  ) {
    cache.set(`${fromPhone}-mode`, "book");
    cache.set(`${fromPhone}-book-stage`, "service");

    const svcs = await listServices();
    cache.set(`${fromPhone}-svclist`, svcs);

    const picked = findServiceByText(incomingMsg, svcs, userLang);
    if (picked) {
      let cleaned = incomingMsg;
      if (userLang === "ar") cleaned = cleanArabicForDate(incomingMsg);

      const startISO =
        extractArabicDate(cleaned) ||
        parseJordanDateTime(cleaned, null, userLang) ||
        parseMonthWordFallback(cleaned, null);

      if (startISO) {
        const durationMin = picked.duration_min || 45;
        const winTxt = formatWindowForReply(startISO, userLang);
        const within = isWithinBusinessHours(startISO, durationMin);
        const { closed } = getBusinessWindowFor(startISO);

        if (closed) {
          let msg = BOT_MESSAGES.closedThatDay[userLang](
            dayLabel(startISO, userLang)
          );
          if (userLang === "ar") msg = toArabicDigits(msg);
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(msg);
          return res.type("text/xml").send(twiml.toString());
        }
        if (!within) {
          let msg = BOT_MESSAGES.outsideBusinessHours[userLang](winTxt || "-");
          if (userLang === "ar") msg = toArabicDigits(msg);
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(msg);
          return res.type("text/xml").send(twiml.toString());
        }

        // NEW: concurrency guard (instant)
        const okCap = await guardMaxConcurrent(
          startISO,
          durationMin,
          userLang,
          res
        );
        if (!okCap) return;

        const id = await makeBooking({
          phone: fromPhone,
          names: [picked.name_en],
          startISO,
          customerName: customerRow?.name || null,
        });

        ["mode", "book-stage", "book-svc", "svclist"].forEach((k) =>
          cache.delete(`${fromPhone}-${k}`)
        );

        let confirm = BOT_MESSAGES.bookedId[userLang](String(id).slice(0, 6));
        if (userLang === "ar") confirm = toArabicDigits(confirm);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(confirm);
        return res.type("text/xml").send(twiml.toString());
      }

      cache.set(`${fromPhone}-book-svc`, picked);
      cache.set(`${fromPhone}-book-stage`, "when");

      const svcTxt =
        userLang === "ar"
          ? picked.name_ar || picked.name_en
          : picked.name_en || picked.name_ar;

      let msg = BOT_MESSAGES.bookingAskWhen[userLang](svcTxt);
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    const body = renderServicesList(svcs, userLang);
    let msg = BOT_MESSAGES.bookingWhichService[userLang] + "\n" + body;
    if (userLang === "ar") msg = toArabicDigits(msg);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }

  // --- QUICK "cancel" entry ---
  if (/\b(cancel|delete|remove)\b/i.test(incomingMsg)) {
    cache.set(`${fromPhone}-mode`, "cancel");
    const bookings = await upcomingBookings(fromPhone);
    console.log(
      "DEBUG upcomingBookings returned count:",
      bookings?.length || 0
    );

    if (bookings.length === 0) {
      let reply = BOT_MESSAGES.noBookingsToCancel[userLang];
      if (userLang === "ar") reply = toArabicDigits(reply);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reply);
      return res.type("text/xml").send(twiml.toString());
    } else if (bookings.length === 1) {
      const svcNames = joinServiceNames(bookings[0].services, userLang);
      const when = formatWhatsAppDate(bookings[0].start_at, userLang);
      cache.set(fromPhone, [bookings[0].id]);
      let reply = BOT_MESSAGES.oneBookingCancel[userLang](svcNames, when);
      if (userLang === "ar") reply = toArabicDigits(reply);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reply);
      return res.type("text/xml").send(twiml.toString());
    } else {
      cache.set(
        fromPhone,
        bookings.map((r) => r.id)
      );
      const listTxt = bookings
        .map((r, i) => {
          const when = formatWhatsAppDate(r.start_at, userLang);
          const svcNames = joinServiceNames(r.services, userLang);
          let line = `${i + 1}️⃣ ${svcNames} – ${when}`;
          if (userLang === "ar") line = toArabicDigits(line);
          return line;
        })
        .join("\n");
      let reply = BOT_MESSAGES.whichBookingToCancel[userLang](listTxt);
      if (userLang === "ar") reply = toArabicDigits(reply);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reply);
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // --- Mode detection ---
  if (
    /\b(update|modify|change|reschedule|edit)\b/i.test(incomingMsg) ||
    /(عدل|تعديل|أعدل|بدي اعدل|حاب اعدل|غيّر|غير|أغير|ابغى اعدل|حابب اعدل)/i.test(
      incomingMsg
    )
  ) {
    cache.set(`${fromPhone}-mode`, "update");
  } else if (
    /\b(cancel|delete|remove)\b/i.test(incomingMsg) ||
    /(الغاء|إلغاء|ألغي|الغي|ألغى|ألغيلي|بدي الغي|حذف|احذف|شطب|شيل|شل|امسح)/i.test(
      incomingMsg
    )
  ) {
    cache.set(`${fromPhone}-mode`, "cancel");
  }

  // --- QUICK UPDATE flow (single selected, fresh) ---
  const pedning = cache.get(fromPhone);
  const mode1 = cache.get(`${fromPhone}-mode`);
  if (
    mode1 === "update" &&
    pedning?.length === 1 &&
    isFreshSelection(fromPhone) &&
    !/^\d+$/.test(incomingMsg.trim())
  ) {
    console.log(
      "Fallback: Forcing update_my_booking for WhatsApp update flow!"
    );

    const arr = pedning;
    const id = arr[0];
    let newISO = null;
    let cleaned = incomingMsg;
    if (userLang === "ar" || /[\u0600-\u06FF]/.test(incomingMsg)) {
      cleaned = cleanArabicForDate(incomingMsg);
    }
    console.log("DEBUG: Arabic normalized string:", cleaned);
    try {
      const existingBooking = await getBookingDetails(id);
      newISO =
        extractArabicDate(cleaned) ||
        parseJordanDateTime(cleaned, existingBooking.start_at, userLang);
      console.log("Quick update newISO:", newISO);

      // Note: Do not fail here just because we didn't parse a time; we may still match a service-only update.

      const updateFields = { id };
      if (newISO) updateFields.newStartISO = newISO;
      const allSvcs = await listServices();
      const norm = (s) => stripPunc(s || "");
      const msgNorm = norm(incomingMsg);

      // 1) exact phrase match (e.g., "classic pedicure")
      const exactMatches = allSvcs.filter((s) => {
        const en = norm(s.name_en);
        const ar = norm(s.name_ar);
        return (en && msgNorm.includes(en)) || (ar && msgNorm.includes(ar));
      });

      // 2) fallback: category tokens
      const wantsPedicure = msgNorm.includes("pedicure");
      const wantsManicure = msgNorm.includes("manicure");
      const pickNamesBy = (needle) =>
        allSvcs
          .filter(
            (s) =>
              norm(s.name_en).includes(needle) ||
              norm(s.name_ar).includes(needle)
          )
          .map((s) => s.name_en || s.name_ar)
          .filter(Boolean);

      let chosenNames = [];
      if (exactMatches.length) {
        chosenNames = exactMatches
          .map((s) => s.name_en || s.name_ar)
          .filter(Boolean);
      } else {
        chosenNames = [
          ...(wantsPedicure ? pickNamesBy("pedicure") : []),
          ...(wantsManicure ? pickNamesBy("manicure") : []),
        ];
      }

      // De-dupe and set
      chosenNames = [...new Set(chosenNames)];
      if (chosenNames.length) {
        updateFields.newServices = chosenNames; // send NAMES; bookingService will map → IDs
      }

      // Re-parse time/date after removing matched service names
      if (!newISO && chosenNames.length) {
        const normTok = (s) => stripPunc(s || "");
        const removeTokens = chosenNames.map(normTok).filter(Boolean);
        let stripped = stripPunc(cleaned);
        for (const tok of removeTokens) {
          if (tok)
            stripped = stripped.replace(tok, " ").replace(/\s+/g, " ").trim();
        }
        if (stripped) {
          const reparsed = parseJordanDateTime(
            stripped,
            existingBooking.start_at,
            userLang
          );
          if (reparsed) {
            newISO = reparsed;
            updateFields.newStartISO = newISO;
          }
        }
      }

      // If we detected neither a time nor any service names, then fail here
      if (!updateFields.newStartISO && !updateFields.newServices) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.dateParseFail[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }
      if (updateFields.newStartISO || updateFields.newServices) {
        if (newISO) {
          // Use duration of newly chosen services if provided; otherwise fall back to existing booking services
          const baseList = chosenNames.length
            ? allSvcs.filter((s) => {
                const nmEn = (s.name_en || "").trim().toLowerCase();
                const nmAr = (s.name_ar || "").trim().toLowerCase();
                return chosenNames.some((n) => {
                  const nn = (n || "").trim().toLowerCase();
                  return nn === nmEn || nn === nmAr;
                });
              })
            : Array.isArray(existingBooking?.services)
            ? existingBooking.services
            : [];
          const svcTotal = baseList.reduce((sum, s) => {
            const d = s.duration_min ?? s.service?.duration_min ?? 0;
            const n = Number(d);
            return sum + (Number.isFinite(n) ? n : 0);
          }, 0);
          const durationMin = svcTotal || 45;

          const winTxt = formatWindowForReply(newISO, userLang);
          const within = isWithinBusinessHours(newISO, durationMin);
          const { closed } = getBusinessWindowFor(newISO);

          if (closed) {
            let msg = BOT_MESSAGES.closedThatDay[userLang](
              dayLabel(newISO, userLang)
            );
            if (userLang === "ar") msg = toArabicDigits(msg);
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(msg);
            return res.type("text/xml").send(twiml.toString());
          }
          if (!within) {
            let msg = BOT_MESSAGES.outsideBusinessHours[userLang](
              winTxt || "-"
            );
            if (userLang === "ar") msg = toArabicDigits(msg);
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(msg);
            return res.type("text/xml").send(twiml.toString());
          }

          // NEW: concurrency guard (update; exclude this booking)
          const okCap3 = await guardMaxConcurrent(
            newISO,
            durationMin,
            userLang,
            res,
            { excludeId: id }
          );
          if (!okCap3) return;
        }

        await updateBooking(updateFields);

        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        clearSelection(fromPhone);

        let updateMsg = BOT_MESSAGES.updatePrefix[userLang];
        if (newISO) {
          const newTime = formatWhatsAppDate(newISO, userLang);
          updateMsg += BOT_MESSAGES.updateNewTime[userLang](newTime);
        }
        if (updateFields.newServices) {
          updateMsg += BOT_MESSAGES.updateNewServices[userLang](
            updateFields.newServices.join(", ")
          );
        }
        updateMsg += BOT_MESSAGES.anythingElse[userLang];
        if (userLang === "ar") updateMsg = toArabicDigits(updateMsg);

        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(updateMsg);
        return res.type("text/xml").send(twiml.toString());
      } else {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("I couldn't understand your update request.");
        return res.type("text/xml").send(twiml.toString());
      }
    } catch (error) {
      console.error("Fallback update error:", error);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.updateError[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // yes/no for single selection
  const yesRe =
    /(?:^|\s)(?:yes|y|ok|okay|sure|نعم|اي|ايوه|أيوه|اه|اها|تمام)(?:\s|[.!،؟]*)$/i;
  const noRe = /(?:^|\s)(?:no|n|لا|لأ|مش|مو)(?:\s|[.!،؟]*)$/i;

  const enAllRe = /^(?:all|.*\b(cancel|yes)\s+all\b.*)$/i;
  const arAllRe =
    /(?:(?:الغي|الغاء|ألغ[ىي]|احذف|شطب|امسح)\s*(?:ال)?(?:كل|جميع(?:\s+الحجوزات)?)|(?:ال)?(?:كل|جميع)\s+(?:الحجوزات|المواعيد)(?:\s*كلها)?)/i;

  const pendingArr = cache.get(fromPhone);
  const mode = cache.get(`${fromPhone}-mode`);

  if (pendingArr && pendingArr.length === 1) {
    if (yesRe.test(incomingMsg)) {
      if (mode === "update") {
        // Accept suggested capacity time if present
        const suggestISO = cache.get(`${fromPhone}-suggest-iso`);
        const suggestDur = cache.get(`${fromPhone}-suggest-duration`) || 45;
        if (suggestISO) {
          cache.delete(`${fromPhone}-suggest-iso`);
          cache.delete(`${fromPhone}-suggest-duration`);
          const arr = cache.get(fromPhone) || [];
          const id = arr[0];
          if (id) {
            try {
              await updateBooking({ id, newStartISO: suggestISO });
              cache.delete(fromPhone);
              cache.delete(`${fromPhone}-mode`);
              clearSelection(fromPhone);
              const newTime = formatWhatsAppDate(suggestISO, userLang);
              let msg =
                BOT_MESSAGES.updatePrefix[userLang] +
                BOT_MESSAGES.updateNewTime[userLang](newTime) +
                BOT_MESSAGES.anythingElse[userLang];
              if (userLang === "ar") msg = toArabicDigits(msg);
              const tw = new twilio.twiml.MessagingResponse();
              tw.message(msg);
              return res.type("text/xml").send(tw.toString());
            } catch (e) {
              const tw = new twilio.twiml.MessagingResponse();
              tw.message(BOT_MESSAGES.updateError[userLang]);
              return res.type("text/xml").send(tw.toString());
            }
          }
        }
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.updateWhat[userLang]);
        return res.type("text/xml").send(twiml.toString());
      } else {
        await cancelBooking(pendingArr[0]);
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        clearSelection(fromPhone);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.cancelDone[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }
    }
    if (noRe.test(incomingMsg)) {
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      clearSelection(fromPhone);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.ok[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }
  }

  if (
    mode === "cancel" &&
    (!pendingArr || pendingArr.length === 0) &&
    /[0-9٠-٩]/.test(incomingMsg)
  ) {
    try {
      const rows = await upcomingBookings(fromPhone);
      if (Array.isArray(rows) && rows.length > 1) {
        cache.set(
          fromPhone,
          rows.map((r) => r.id)
        );
      }
    } catch (e) {
      console.error("Auto-load upcoming for cancel failed:", e);
    }
  }

  const multiPending = cache.get(fromPhone);
  if (multiPending && multiPending.length > 1 && mode === "cancel") {
    if (enAllRe.test(incomingMsg) || arAllRe.test(incomingMsg)) {
      for (const id of multiPending) await cancelBooking(id);
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      clearSelection(fromPhone);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.cancelAllDone[userLang](multiPending.length));
      return res.type("text/xml").send(twiml.toString());
    }

    const normalized = toEnglishDigits(incomingMsg)
      .replace(/[،,]+/g, " ")
      .replace(/\s+و\s+/g, " ")
      .trim();

    const tokens = normalized.split(/\s+/);
    const picked = [];
    for (const tok of tokens) {
      const m = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) {
        const a = parseInt(m[1], 10),
          b = parseInt(m[2], 10);
        const lo = Math.min(a, b),
          hi = Math.max(a, b);
        for (let k = lo; k <= hi; k++) picked.push(k);
      } else if (/^\d+$/.test(tok)) picked.push(parseInt(tok, 10));
    }

    const uniqueIndexes = [...new Set(picked)].filter(
      (idx) => idx >= 1 && idx <= multiPending.length
    );

    if (uniqueIndexes.length > 0) {
      for (const idx of uniqueIndexes) {
        await cancelBooking(multiPending[idx - 1]);
      }
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      clearSelection(fromPhone);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(
        BOT_MESSAGES.cancelSomeDone[userLang](uniqueIndexes.join(", "))
      );
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // --- Numeric selection for update/cancel ---
  const pending = cache.get(fromPhone);
  const modeForPick = cache.get(`${fromPhone}-mode`);

  // UPDATE: allow picking even if only 1 item (explicit selection required)
  // CANCEL: keep old behavior (only list-pick when multiple)
  const allowPick =
    (modeForPick === "update" && pending && pending.length >= 1) ||
    (modeForPick === "cancel" && pending && pending.length > 1);

  if (allowPick) {
    const idx = parseInt(toEnglishDigits(incomingMsg.trim()), 10);
    if (!isNaN(idx) && idx >= 1 && idx <= pending.length) {
      if (modeForPick === "update") {
        cache.set(fromPhone, [pending[idx - 1]]);
        markSelected(fromPhone);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.updateWhat[userLang]);
        return res.type("text/xml").send(twiml.toString());
      } else {
        await cancelBooking(pending[idx - 1]);
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        clearSelection(fromPhone);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.cancelDone[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }
    }
  }

  // --- BOOK stage: waiting for service selection ---
  if (
    cache.get(`${fromPhone}-mode`) === "book" &&
    cache.get(`${fromPhone}-book-stage`) === "service"
  ) {
    const svcs = cache.get(`${fromPhone}-svclist`) || (await listServices());
    cache.set(`${fromPhone}-svclist`, svcs);

    const picked = findServiceByText(incomingMsg, svcs, userLang);
    if (!picked) {
      const body = renderServicesList(svcs, userLang);
      let msg = BOT_MESSAGES.bookingWhichService[userLang] + "\n" + body;
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    cache.set(`${fromPhone}-book-svc`, picked);
    cache.set(`${fromPhone}-book-stage`, "when");

    const svcTxt =
      userLang === "ar"
        ? picked.name_ar || picked.name_en
        : picked.name_en || picked.name_ar;
    let msg = BOT_MESSAGES.bookingAskWhen[userLang](svcTxt);
    if (userLang === "ar") msg = toArabicDigits(msg);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }

  // --- BOOK stage: waiting for date/time ---
  if (
    cache.get(`${fromPhone}-mode`) === "book" &&
    cache.get(`${fromPhone}-book-stage`) === "when"
  ) {
    const svc = cache.get(`${fromPhone}-book-svc`);
    const svcs = cache.get(`${fromPhone}-svclist`) || [];

    if (!svc) {
      cache.set(`${fromPhone}-book-stage`, "service");
      const body = renderServicesList(
        svcs.length ? svcs : await listServices(),
        userLang
      );
      let msg = BOT_MESSAGES.bookingWhichService[userLang] + "\n" + body;
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    let cleaned = incomingMsg;
    if (userLang === "ar") cleaned = cleanArabicForDate(incomingMsg);

    const startISO =
      extractArabicDate(cleaned) ||
      parseJordanDateTime(cleaned, null, userLang) ||
      parseMonthWordFallback(cleaned, null);

    if (!startISO) {
      let msg = BOT_MESSAGES.bookingDateFail[userLang];
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    const durationMin = svc.duration_min || 45;
    const winTxt = formatWindowForReply(startISO, userLang);
    const within = isWithinBusinessHours(startISO, durationMin);
    const { closed } = getBusinessWindowFor(startISO);

    if (closed) {
      let msg = BOT_MESSAGES.closedThatDay[userLang](
        dayLabel(startISO, userLang)
      );
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }
    if (!within) {
      let msg = BOT_MESSAGES.outsideBusinessHours[userLang](winTxt || "-");
      if (userLang === "ar") msg = toArabicDigits(msg);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    // NEW: concurrency guard (book "when")
    const okCap = await guardMaxConcurrent(
      startISO,
      durationMin,
      userLang,
      res
    );
    if (!okCap) return;

    const id = await makeBooking({
      phone: fromPhone,
      names: [svc.name_en],
      startISO,
      customerName: customerRow?.name || null,
    });

    ["mode", "book-stage", "book-svc", "svclist"].forEach((k) =>
      cache.delete(`${fromPhone}-${k}`)
    );

    let confirm = BOT_MESSAGES.bookedId[userLang](String(id).slice(0, 6));
    if (userLang === "ar") confirm = toArabicDigits(confirm);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(confirm);
    return res.type("text/xml").send(twiml.toString());
  }

  // --- Build prompt for GPT and let it run actions ---
  const menuText = await buildServiceMenuText();
  const chat = [
    {
      role: "system",
      content: `You are a friendly bilingual nail-salon bot for WhatsApp.
You have access to functions like list_my_bookings, update_my_booking, make_booking, etc. Use them as described below.
Your goal is to always keep track of the currently pending action, such as updating a booking.

UPDATE BEHAVIOR INSTRUCTIONS:
- If the user wants to update a booking, you must first help them select the booking by calling list_my_bookings.
- After the user selects a booking (by replying with a number, e.g. "1"), ANY following user message (unless it is another number or a cancellation) should be treated as a request to update that specific booking.
- When the user sends an update command (like "Change it to 7 July at 6 pm" or "Make it pedicure"), ALWAYS call the function update_my_booking, passing:
    - booking_index: the index of the selected booking (usually 1 if only one booking is pending update).
    - Extract the new time, date, and/or service name(s) from their message, and pass them as new_start_text and/or new_service_names as appropriate.
- Never call list_my_bookings again after a booking is selected, unless the user asks to see all bookings again.
- For example:
    - User: "1"  (after seeing booking list) → selects booking 1 for update
    - User: "Change it to 7 July at 6 pm"  → You must call update_my_booking with booking_index: 1, new_start_text: "7 July at 6 pm"
- If you are not sure which booking the user wants to update, or the selection is ambiguous, call list_my_bookings.

${menuText}

⚠️ When calling make_booking or update_my_booking, put the user's date words (e.g. 'tomorrow at 6 pm') in the text field. DO NOT convert to ISO.
`,
    },
    { role: "user", content: incomingMsg },
  ];

  let bot;
  try {
    console.log(
      "Cache:",
      fromPhone,
      cache.get(fromPhone),
      "Message:",
      incomingMsg
    );
    bot = await talkToGPT(chat, fromPhone);
    console.log("GPT Response:", JSON.stringify(bot));
  } catch (e) {
    console.error("GPT Error:", e);
    bot = { reply: "Oops, server error." };
  }

  if (bot.reply) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(bot.reply);
    return res.type("text/xml").send(twiml.toString());
  }

  if (bot.functionCall) {
    const { name, args } = bot.functionCall;

    if (name === "list_services") {
      const svcs = await listServices();
      const body = renderServicesList(svcs, userLang);
      const twiml = new twilio.twiml.MessagingResponse();
      let msg = BOT_MESSAGES.servicesHeader[userLang](body);
      if (userLang === "ar") msg = toArabicDigits(msg);
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    if (name === "make_booking") {
      const startISO = parseJordanDateTime(args.start_at_text, null, userLang);
      if (!startISO) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(
          "Sorry, I couldn't understand that date. Try '25 June 3 pm'."
        );
        return res.type("text/xml").send(twiml.toString());
      }

      // Opening-hours guard (and compute durationMin from service_names)
      let durationMin = 45;
      try {
        const allSvcs = await listServices();
        if (
          Array.isArray(args.service_names) &&
          args.service_names.length &&
          Array.isArray(allSvcs)
        ) {
          const norm = (s) => (s || "").trim().toLowerCase();
          const wanted = new Set(args.service_names.map(norm));
          const sum = allSvcs.reduce((acc, s) => {
            const en = norm(s.name_en),
              ar = norm(s.name_ar);
            if (wanted.has(en) || wanted.has(ar)) {
              const d = Number(s.duration_min) || 0;
              return acc + d;
            }
            return acc;
          }, 0);
          if (sum > 0) durationMin = sum;
        }
      } catch {}

      const winTxt = formatWindowForReply(startISO, userLang);
      const within = isWithinBusinessHours(startISO, durationMin);
      const { closed } = getBusinessWindowFor(startISO);

      if (closed) {
        let msg = BOT_MESSAGES.closedThatDay[userLang](
          dayLabel(startISO, userLang)
        );
        if (userLang === "ar") msg = toArabicDigits(msg);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(msg);
        return res.type("text/xml").send(twiml.toString());
      }
      if (!within) {
        let msg = BOT_MESSAGES.outsideBusinessHours[userLang](winTxt || "-");
        if (userLang === "ar") msg = toArabicDigits(msg);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(msg);
        return res.type("text/xml").send(twiml.toString());
      }

      // NEW: concurrency guard (GPT make_booking)
      const okCap2 = await guardMaxConcurrent(
        startISO,
        durationMin,
        userLang,
        res
      );
      if (!okCap2) return;

      const id = await makeBooking({
        phone: fromPhone,
        names: args.service_names,
        startISO,
        customerName: customerRow?.name || null,
      });
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.bookedId[userLang](String(id).slice(0, 6)));
      return res.type("text/xml").send(twiml.toString());
    }

    // --- GPT functionCall: list_my_bookings ---
    // --- GPT functionCall: list_my_bookings ---
    if (name === "list_my_bookings") {
      const rows = await upcomingBookings(fromPhone);

      if (!rows || rows.length === 0) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.noBookings[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }

      const modeForList = cache.get(`${fromPhone}-mode`) || "cancel";

      // ✅ UPDATE: always show selection list (even if only one item). Do NOT auto-select.
      if (modeForList === "update") {
        // Save ALL IDs (even single) so the user must pick explicitly by number.
        cache.set(
          fromPhone,
          rows.map((r) => r.id)
        );

        const listTxt = rows
          .map((r, i) => {
            const when = formatWhatsAppDate(r.start_at, userLang);
            const svcNames = joinServiceNames(r.services, userLang);
            let line = `${i + 1}️⃣ ${svcNames} – ${when}`;
            if (userLang === "ar") line = toArabicDigits(line);
            return line;
          })
          .join("\n");

        let reply = BOT_MESSAGES.whichBookingToUpdate[userLang](listTxt);
        if (userLang === "ar") reply = toArabicDigits(reply);

        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(reply);
        return res.type("text/xml").send(twiml.toString());
      }

      // 🟨 CANCEL: keep existing UX (auto-confirm if exactly one)
      if (rows.length === 1) {
        cache.set(fromPhone, [rows[0].id]);
        const svcNames = joinServiceNames(rows[0].services, userLang);
        const when = formatWhatsAppDate(rows[0].start_at, userLang);

        let msg = BOT_MESSAGES.foundOneCancel[userLang](svcNames, when);
        if (userLang === "ar") msg = toArabicDigits(msg);

        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(msg);
        return res.type("text/xml").send(twiml.toString());
      }

      // CANCEL with multiple: list & ask
      cache.set(
        fromPhone,
        rows.map((r) => r.id)
      );

      const listTxt = rows
        .map((r, i) => {
          const when = formatWhatsAppDate(r.start_at, userLang);
          const svcNames = joinServiceNames(r.services, userLang);
          let line = `${i + 1}️⃣ ${svcNames} – ${when}`;
          if (userLang === "ar") line = toArabicDigits(line);
          return line;
        })
        .join("\n");

      let reply = BOT_MESSAGES.whichBookingToCancel[userLang](listTxt);
      if (userLang === "ar") reply = toArabicDigits(reply);

      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(reply);
      return res.type("text/xml").send(twiml.toString());
    }

    if (name === "cancel_booking_by_index") {
      const arr = cache.get(fromPhone) || [];
      const id = arr[args.index - 1];
      if (!id) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.unknownBookingNumber[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }
      await cancelBooking(id);
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      clearSelection(fromPhone);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.cancelDone[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }

    if (name === "update_my_booking") {
      return handleUpdateBooking(args, fromPhone, userLang, res);
    }

    if (name === "ask_what_to_update") {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.updateWhat[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(BOT_MESSAGES.fallback[userLang]);
    return res.type("text/xml").send(twiml.toString());
  }

  // --- FINAL fallback update (rare) ---
  const pending2 = cache.get(fromPhone);
  const mode2 = cache.get(`${fromPhone}-mode`);
  if (
    mode2 === "update" &&
    pending2?.length === 1 &&
    !/^\d+$/.test(incomingMsg.trim())
  ) {
    console.log("Fallback: Manual update processing as last resort");

    const arr = pending2;
    const id = arr[0];
    let newISO = null;
    let serviceNamesForReply = null;
    try {
      const existingBooking = await getBookingDetails(id);
      newISO = parseJordanDateTime(
        incomingMsg,
        existingBooking.start_at,
        userLang
      );

      console.log("Fallback update newISO:", newISO);

      // Try to extract requested services from free text
      let matchedServices = [];
      try {
        const allServices = await listServices();
        const normMsg = stripPunc(incomingMsg).toLowerCase();
        matchedServices = (allServices || []).filter((s) => {
          const names = [s.name_en || "", s.name_ar || ""]
            .map((n) => stripPunc(n).toLowerCase())
            .filter(Boolean);
          return names.some((n) => n && normMsg.includes(n));
        });
        if (matchedServices.length) {
          console.log(
            "Fallback: matched services from message ->",
            matchedServices.map((s) => s.name_en || s.name_ar),
            "ids=",
            matchedServices.map((s) => s.id ?? s.service_id)
          );
        }
      } catch (e) {
        console.error("Fallback: error matching services from message:", e);
      }

      // Re-parse time/date after removing matched service names
      if (!newISO && matchedServices.length) {
        const normTok = (s) => stripPunc(s || "");
        const removeTokens = matchedServices
          .map((s) => normTok(s.name_en) || normTok(s.name_ar))
          .filter(Boolean);
        let stripped = stripPunc(incomingMsg);
        for (const tok of removeTokens) {
          if (tok)
            stripped = stripped.replace(tok, " ").replace(/\s+/g, " ").trim();
        }
        if (stripped) {
          const reparsed = parseJordanDateTime(
            stripped,
            existingBooking.start_at,
            userLang
          );
          if (reparsed) newISO = reparsed;
        }
      }

      if (!newISO && matchedServices.length === 0) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(BOT_MESSAGES.dateParseFail[userLang]);
        return res.type("text/xml").send(twiml.toString());
      }

      const updateFields = { id };
      if (newISO) updateFields.newStartISO = newISO;
      if (matchedServices.length > 0) {
        updateFields.newServices = matchedServices
          .map((s) => s.name_en || s.name_ar)
          .filter(Boolean);

        serviceNamesForReply = matchedServices.map((s) =>
          userLang === "ar" ? s.name_ar || s.name_en : s.name_en || s.name_ar
        );
      }

      if (updateFields.newStartISO || updateFields.newServices) {
        if (newISO) {
          // Use duration of matched services if provided; otherwise fall back to existing booking services
          const baseList =
            matchedServices.length > 0
              ? matchedServices
              : Array.isArray(existingBooking?.services)
              ? existingBooking.services
              : [];
          const svcTotal = baseList.reduce((sum, s) => {
            const d = s.duration_min ?? s.service?.duration_min ?? 0;
            const n = Number(d);
            return sum + (Number.isFinite(n) ? n : 0);
          }, 0);
          const durationMin = svcTotal || 45;

          const winTxt = formatWindowForReply(newISO, userLang);
          const within = isWithinBusinessHours(newISO, durationMin);
          const { closed } = getBusinessWindowFor(newISO);

          if (closed) {
            let msg = BOT_MESSAGES.closedThatDay[userLang](
              dayLabel(newISO, userLang)
            );
            if (userLang === "ar") msg = toArabicDigits(msg);
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(msg);
            return res.type("text/xml").send(twiml.toString());
          }
          if (!within) {
            let msg = BOT_MESSAGES.outsideBusinessHours[userLang](
              winTxt || "-"
            );
            if (userLang === "ar") msg = toArabicDigits(msg);
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(msg);
            return res.type("text/xml").send(twiml.toString());
          }

          // NEW: concurrency guard (final fallback; exclude this booking)
          const okCap5 = await guardMaxConcurrent(
            newISO,
            durationMin,
            userLang,
            res,
            { excludeId: id }
          );
          if (!okCap5) return;
        }

        const updatedBooking = await updateBooking(updateFields);
        await sendWhatsAppBookingUpdate(fromPhone, updatedBooking);

        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        clearSelection(fromPhone);

        let updateMsg = "🔄 Updated your booking!";
        if (newISO) {
          const newTime = DateTime.fromISO(newISO)
            .setZone("Asia/Amman")
            .toFormat("ccc d LLL HH:mm");
          updateMsg += ` New time: ${newTime}`;
        }
        if (updateFields.newServices) {
          const namesForReply =
            serviceNamesForReply || updateFields.newServices;
          updateMsg += ` New services: ${namesForReply.join(", ")}`;
        }

        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(updateMsg + "\n\nLet me know if there's anything else!");
        return res.type("text/xml").send(twiml.toString());
      } else {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("I couldn't understand your update request.");
        return res.type("text/xml").send(twiml.toString());
      }
    } catch (error) {
      console.error("Fallback update error:", error);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(BOT_MESSAGES.updateError[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(BOT_MESSAGES.fallback[userLang]);
  return res.type("text/xml").send(twiml.toString());
}

async function handleUpdateBooking(args, fromPhone, userLang, res) {
  const twiml = new twilio.twiml.MessagingResponse();

  // 1. Get Booking ID from cache
  const bookingIdArr = cache.get(fromPhone) || [];
  const bookingIndex = args.booking_index ?? 1;
  const bookingId = bookingIdArr[bookingIndex - 1];

  if (!bookingId) {
    twiml.message(BOT_MESSAGES.unknownBookingNumber[userLang]);
    return res.type("text/xml").send(twiml.toString());
  }

  // 2. Fetch details for existing booking and all available services
  let existingBooking;
  let allServices;
  try {
    [existingBooking, allServices] = await Promise.all([
      getBookingDetails(bookingId),
      listServices(),
    ]);
    // Normalize services list to have a stable 'id' key
    if (Array.isArray(allServices)) {
      allServices = allServices.map((s) => ({
        ...s,
        id: s.id ?? s.service_id,
      }));
    }
  } catch (error) {
    console.error("Error fetching booking/service details:", error);
    twiml.message(BOT_MESSAGES.updateError[userLang]);
    return res.type("text/xml").send(twiml.toString());
  }

  if (!existingBooking) {
    twiml.message(BOT_MESSAGES.unknownBookingNumber[userLang]);
    return res.type("text/xml").send(twiml.toString());
  }

  // 3. Initialize new booking details with existing values
  let newStartISO = existingBooking.start_at;
  // Ensure we carry over current services with a normalized 'id'
  let newServices = Array.isArray(existingBooking.services)
    ? existingBooking.services.map((s) => ({ ...s, id: s.id ?? s.service_id }))
    : [];

  try {
    console.log(
      "handleUpdateBooking:init bookingId=%s, currentServiceIds=%o, requested=%o",
      bookingId,
      newServices.map((s) => s.id),
      args && args.new_service_names
    );
  } catch {}

  let hasDateOrTimeUpdate = false;
  let hasServiceUpdate = false;

  // 4. Parse and validate new services, if provided
  if (
    Array.isArray(args.new_service_names) &&
    args.new_service_names.length > 0
  ) {
    const requestedServiceNames = args.new_service_names.map((s) =>
      stripPunc(s)
    );
    const foundServices = [];
    for (const requestedName of requestedServiceNames) {
      const found = allServices.find((s) => {
        const cand = [s.name_en || "", s.name_ar || ""].map(stripPunc);
        return cand.some(
          (v) => v && (v === requestedName || v.includes(requestedName))
        );
      });
      if (found) {
        foundServices.push(found);
      }
    }

    if (foundServices.length !== requestedServiceNames.length) {
      const notFound = requestedServiceNames.filter(
        (name) =>
          !allServices.some(
            (s) =>
              stripPunc(s.name_en || "").includes(name) ||
              stripPunc(s.name_ar || "").includes(name)
          )
      );
      const msg =
        userLang === "ar"
          ? `عذراً، لم نجد الخدمة: ${notFound.join(", ")}`
          : `Sorry, I couldn't find the service: ${notFound.join(", ")}.`;
      twiml.message(msg);
      return res.type("text/xml").send(twiml.toString());
    }

    const newServiceIds = new Set(
      foundServices.map((s) => s.id ?? s.service_id)
    );
    const oldServiceIds = new Set(newServices.map((s) => s.id ?? s.service_id));

    if (
      newServiceIds.size !== oldServiceIds.size ||
      [...newServiceIds].some((id) => !oldServiceIds.has(id))
    ) {
      hasServiceUpdate = true;
      newServices = foundServices.map((s) => ({
        ...s,
        id: s.id ?? s.service_id,
      }));
      try {
        console.log(
          "handleUpdateBooking: service change detected -> %o",
          Array.from(newServiceIds)
        );
      } catch {}
    }
  }

  // 5. Parse new date/time, if provided
  if (args.new_start_text) {
    const parsedTimeISO = parseJordanDateTime(
      args.new_start_text,
      existingBooking.start_at,
      userLang
    );

    if (!parsedTimeISO) {
      twiml.message(BOT_MESSAGES.dateParseFail[userLang]);
      return res.type("text/xml").send(twiml.toString());
    }

    // Check if there is a meaningful change in time (e.g., > 1 minute)
    const diff = Math.abs(
      DateTime.fromISO(parsedTimeISO).diff(
        DateTime.fromISO(newStartISO),
        "minutes"
      ).minutes
    );
    if (diff > 1) {
      hasDateOrTimeUpdate = true;
      newStartISO = parsedTimeISO;
    }
  }

  // 6. Check if anything actually changed
  if (!hasDateOrTimeUpdate && !hasServiceUpdate) {
    const msg =
      userLang === "ar" ? "لم يتم اكتشاف أي تغييرات." : "No changes detected.";
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }

  // 7. Validations for the new booking state
  const newDurationMin = newServices.reduce(
    (sum, s) => sum + (Number(s.duration_min) || 0),
    0
  );

  // a. Past time validation
  if (DateTime.fromISO(newStartISO) < DateTime.now().setZone(TIME_ZONE)) {
    const msg =
      userLang === "ar"
        ? "لا يمكن تحديث الحجز لوقت في الماضي."
        : "Cannot update booking to a past time.";
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }

  // b. Business hours validation
  const { closed } = getBusinessWindowFor(newStartISO);
  if (closed) {
    let msg = BOT_MESSAGES.closedThatDay[userLang](
      dayLabel(newStartISO, userLang)
    );
    if (userLang === "ar") msg = toArabicDigits(msg);
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }
  const winTxt = formatWindowForReply(newStartISO, userLang);
  const within = isWithinBusinessHours(newStartISO, newDurationMin);
  if (!within) {
    let msg = BOT_MESSAGES.outsideBusinessHours[userLang](winTxt || "-");
    if (userLang === "ar") msg = toArabicDigits(msg);
    twiml.message(msg);
    return res.type("text/xml").send(twiml.toString());
  }
  // c. Concurrency validation
  const isConcurrent = await guardMaxConcurrent(
    newStartISO,
    newDurationMin,
    userLang,
    res,
    { excludeId: bookingId }
  );
  if (!isConcurrent) {
    // guardMaxConcurrent sends its own reply
    return;
  }
  // 8. Execute the update
  try {
    await updateBooking({
      id: bookingId,
      newStartISO: hasDateOrTimeUpdate ? newStartISO : undefined,
      // pass names, not IDs
      newServices: hasServiceUpdate
        ? newServices.map((s) => s.name_en || s.name_ar).filter(Boolean)
        : undefined,
    });
  } catch (error) {
    console.error("Update booking failed:", error);
    twiml.message(BOT_MESSAGES.updateError[userLang]);
    return res.type("text/xml").send(twiml.toString());
  }

  // 9. Send confirmation
  cache.delete(fromPhone);
  cache.delete(`${fromPhone}-mode`);
  clearSelection(fromPhone);

  let confirmMsg = BOT_MESSAGES.updatePrefix[userLang];
  if (hasDateOrTimeUpdate) {
    const newTime = formatWhatsAppDate(newStartISO, userLang);
    confirmMsg += BOT_MESSAGES.updateNewTime[userLang](newTime);
  }
  if (hasServiceUpdate) {
    const newServiceNames = joinServiceNames(
      newServices.map((s) => ({ service: s })),
      userLang
    );
    confirmMsg += BOT_MESSAGES.updateNewServices[userLang](newServiceNames);
  }
  confirmMsg += BOT_MESSAGES.anythingElse[userLang];

  if (userLang === "ar") confirmMsg = toArabicDigits(confirmMsg);

  twiml.message(confirmMsg);
  return res.type("text/xml").send(twiml.toString());
}

module.exports = { handleIncomingMessage, sendWhatsAppBookingUpdate };

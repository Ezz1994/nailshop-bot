// time.js
const { DateTime } = require("luxon");
const { recognizeDateTime } = require("@microsoft/recognizers-text-suite");

// =========================
// AR / EN constants (yours)
// =========================
const AR_DAY = {
  الاحد: "sunday",
  الأحد: "sunday",
  احد: "sunday",
  الاثنين: "monday",
  الإثنين: "monday",
  اثنين: "monday",
  الثلاثاء: "tuesday",
  ثلاثاء: "tuesday",
  الاربعاء: "wednesday",
  الأربعاء: "wednesday",
  اربعاء: "wednesday",
  أربعاء: "wednesday",
  الخميس: "thursday",
  خميس: "thursday",
  الجمعة: "friday",
  جمعه: "friday",
  الجمعه: "friday",
  جمعة: "friday",
  السبت: "saturday",
  سبت: "saturday",
};
const AR_REL = {
  بكرا: "tomorrow",
  بكره: "tomorrow",
  غداً: "tomorrow",
  غدا: "tomorrow",
  "بعد بكرا": "day after tomorrow",
  "بعد غداً": "day after tomorrow",
};
const AR_MONTH = {
  "كانون الثاني": "January",
  يناير: "January",
  شباط: "February",
  فبراير: "February",
  آذار: "March",
  مارس: "March",
  نيسان: "April",
  ابريل: "April",
  أبريل: "April",
  أيار: "May",
  مايو: "May",
  حزيران: "June",
  يونيو: "June",
  تموز: "July",
  يوليو: "July",
  آب: "August",
  أغسطس: "August",
  اغسطس: "August",
  أيلول: "September",
  ايلول: "September",
  سبتمبر: "September",
  اكتوبر: "October",
  "تشرين الأول": "October",
  "تشرين الاول": "October",
  أكتوبر: "October",
  "تشرين الثاني": "November",
  نوفمبر: "November",
  "كانون الأول": "December",
  "كانون الاول": "December",
  اذار: "March",
  ديسمبر: "December",
  ايار: "May",
};

// put near your other constants
const MONTH_RE =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";


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

// =========================
// util: digits + formatting
// =========================
function arabicIndicToEnglish(str = "") {
  return str.replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}
function toArabicDigits(str = "") {
  return str.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

// =====================================
// map Arabic AM/PM and remove "ساعة"
// =====================================
function replaceArabicAmPm(text) {
  // strip tatweel + harakat
  text = text.replace(/\u0640/gu, "");
  text = text.replace(/[\u064B-\u0652]/gu, "");

  // PM tokens
  text = text.replace(
    /(^|[\s:،,.\-])بعد\s+ال[ظض]هر(?=$|[\s:،,.\-]|$)/gu,
    "$1 pm "
  );
  text = text.replace(
    /(^|[\s:،,.\-])ال?[ظض]هر(?:ا)?(?=$|[\s:،,.\-]|$)/gu,
    "$1 pm "
  );
  text = text.replace(/(^|[\s:،,.\-])العصر(?=$|[\s:،,.\-]|$)/gu, "$1 pm ");
  text = text.replace(
    /(^|[\s:،,.\-])(مساء(?:ا)?|المساء|مسا)(?=$|[\s:،,.\-]|$)/gu,
    "$1 pm "
  );
  text = text.replace(
    /(^|[\s:،,.\-])(المغرب|مغرب)(?=$|[\s:،,.\-]|$)/gu,
    "$1 pm "
  );
  text = text.replace(
    /(^|[\s:،,.\-])(ليل(?:ا)?|الليل)(?=$|[\s:،,.\-]|$)/gu,
    "$1 pm "
  );

  // AM tokens
  text = text.replace(
    /(^|[\s:،,.\-])(الصبح|صبح)(?=$|[\s:،,.\-]|$)/gu,
    "$1 am "
  );
  text = text.replace(/(^|[\s:،,.\-])صباح(?:ا)?(?=$|[\s:،,.\-]|$)/gu, "$1 am ");
  text = text.replace(
    /(^|[\s:،,.\-])(الفجر|فجر)(?=$|[\s:،,.\-]|$)/gu,
    "$1 am "
  );

  // remove ساعة variants (both ة and ه)
  text = text.replace(
    /(^|[\s:،,.\-])(الساعة|ساعة|ساعه)(?=$|[\s:،,.\-]|$)/gu,
    " "
  );

  return text;
}

// =====================================
// apply your AR maps (days/rel/months)
// =====================================
function applyArabicMaps(text) {
  let t = arabicIndicToEnglish(text);

  // map relative, weekdays, and months
  for (const [ar, en] of Object.entries(AR_REL)) {
    t = t.replace(new RegExp(ar, "giu"), en);
  }
  for (const [ar, en] of Object.entries(AR_DAY)) {
    t = t.replace(new RegExp(ar, "giu"), en);
  }
  for (const [ar, en] of Object.entries(AR_MONTH)) {
    t = t.replace(new RegExp(ar, "giu"), en);
  }
  return t;
}

// =====================================
// normalization used before parsing
// =====================================
function normalizeArabicTime(text) {
  // maps + am/pm
  let t = applyArabicMaps(text);
  t = replaceArabicAmPm(t);

  // remove common fillers (Arabic + English)
  t = t
    .replace(
      /(?:بدي|أ?عدل|تعديل|حاب|حابب|ابغى|التاريخ|تاريخ|ليوم|يوم|الوقت|الساعة|ساعة|إلى|الى|على|عال|ال)/giu,
      " "
    )
    .replace(/\b(of|at|to|for|on|this|coming|the)\b/gi, " ");

  // drop any remaining Arabic words (we already mapped important tokens)
  t = t.replace(/[\u0600-\u06FF]+/gu, " ");

  // normalize time and spaces
  t = t
    .replace(/(\d)(am|pm)\b/gi, "$1 $2")
    .replace(/(\d{1,2})\s*[:٫،]\s*(\d{2})/g, "$1:$2")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  try {
    console.log("[DT_PARSE] arabic normalized ->", t);
  } catch {}
  return t;
}

// =====================================
// cleaning for user-facing Arabic text
// =====================================
function cleanArabicForDate(text) {
  return (
    text
      // Remove common intent/filler words
      .replace(
        /(?:بدي|أ?عدل|تعديل|حاب|حابب|ابغى|التاريخ|تاريخ|ليوم|يوم|الوقت|الساعة|ساعة|إلى|الى|على|عال|ال)/g,
        ""
      )
      // Remove extra spaces and minor fillers
      .replace(/\b(?:اه|آه|ايوه|طيب)\b/gi, "")
      .replace(/\bل\s+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// =====================================
// Arabic: first try strict D/M/Y + time
// then recognizers (ar-sa)
// =====================================
function extractArabicDate(text, refDate = new Date(), noRecurse = false) {
  const zone = "Asia/Amman";
  const now = DateTime.fromJSDate(refDate).setZone(zone);

  // 1) Normalize digits and am/pm words
  let src = arabicIndicToEnglish(text);
  let forTime = replaceArabicAmPm(src);

  // 2) Try explicit D/M(/Y)
  const dmy = forTime.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  let day = null,
    month = null,
    year = null;
  if (dmy) {
    day = parseInt(dmy[1], 10);
    month = parseInt(dmy[2], 10);
    year = dmy[3] ? parseInt(dmy[3], 10) : now.year;
    if (year < 100) year += 2000;
  }

  // 3) Extract time (if any)
  let hour = null,
    minute = 0,
    ap = "";

  // Date position to prioritize time after the date token
  const dmyRe = /(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/g;
  let dmyExec = dmyRe.exec(forTime);
  const afterIdx = dmyExec ? dmyExec.index + dmyExec[0].length : 0;

  const timeReAll =
    /(?:الساعة|ساعة|ساعه)?\s*(\d{1,2})(?:\s*[:٫،]\s*(\d{2}))?\s*(am|pm)?/gi;
  let best = null;
  for (const m of forTime.matchAll(timeReAll)) {
    const idx = m.index;
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const apTok = (m[3] || "").toLowerCase();
    if (isNaN(h) || h < 0 || h > 12) continue;
    const candidate = {
      idx,
      h,
      min,
      apTok,
      hasAp: apTok === "am" || apTok === "pm",
    };
    if (idx >= afterIdx) {
      if (
        !best ||
        (candidate.hasAp && !best.afterHasAp) ||
        (candidate.hasAp === best.afterHasAp && idx >= best.idx)
      ) {
        best = { ...candidate, after: true, afterHasAp: candidate.hasAp };
      }
    } else if (!best) {
      best = { ...candidate, after: false, afterHasAp: candidate.hasAp };
    }
  }
  if (best) {
    hour = best.h;
    minute = best.min;
    ap = best.apTok;
  }

  // If D/M date, construct DateTime now.
  if (day != null && month != null) {
    let dt = DateTime.fromObject(
      { year, month, day, hour: 12, minute: 0, second: 0, millisecond: 0 },
      { zone }
    );
    if (hour != null) {
      let h = hour;
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      dt = dt.set({ hour: h, minute });
    }
    return dt.toISO();
  }

  // 4) Microsoft Recognizers (Arabic)
  if (!noRecurse) {
    try {
      const res = recognizeDateTime(text, "ar-sa", refDate) || [];
      if (res.length) {
        const v = res[0].resolution?.values?.[0];
        if (v?.value) {
          // If recognizer gave date-only and we captured a time, merge them
          if (/^\d{4}-\d{2}-\d{2}$/.test(v.value) && hour != null) {
            let dt = DateTime.fromISO(v.value, { zone });
            let h = hour;
            if (ap === "pm" && h < 12) h += 12;
            if (ap === "am" && h === 12) h = 0;
            dt = dt.set({ hour: h, minute });
            return dt.toISO();
          }
          return DateTime.fromISO(v.value, { zone }).toISO();
        }
      }
    } catch (e) {}
  }

  return null;
}

// =====================================
// Month-word parser using your MONTH_RE
// e.g. "2 sep 11 am", "2nd of september", "2 sep 2025 11 am"
// =====================================
// Month-word regex: match date phrases anywhere in the string
// Match things like "22 Sep 10 am", "2nd of September", etc. anywhere in the text
const MONTH_WORD_RE = new RegExp(
  String.raw`\b(\d{1,2})\s+(?:of\s+)?${MONTH_RE}\b(?:\s+(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b`,
  "i"
);

function tryMonthWordParse(cleaned, existingDt, now, zone = "Asia/Amman") {
  const m = cleaned.match(MONTH_WORD_RE);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const monToken = (m[2] || "").toLowerCase();
  const month = EN_MONTH[monToken] || EN_MONTH[monToken.slice(0, 3)] || null;
  if (!month) return null;

  const hasYear = !!m[3];
  let year = hasYear ? parseInt(m[3], 10) : now.year;

  let hour, minute;
  if (m[4]) {
    hour = parseInt(m[4], 10);
    minute = m[5] ? parseInt(m[5], 10) : 0;
    const ap = (m[6] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  } else {
    // no explicit time → keep existing time or default 11:00
    hour = existingDt ? existingDt.hour : 11;
    minute = existingDt ? existingDt.minute : 0;
  }

  let dt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone }
  );

  // If year omitted and result is in the past, bump to next year
  if (!hasYear && dt <= now) dt = dt.plus({ years: 1 });

  const out = dt.toISO();
  try { console.log("[DT_PARSE] month-word ->", out, { day, month, year, hour, minute }); } catch {}
  return out;
}



// =====================================
// Nearest upcoming weekday helper
// =====================================
function nextWeekdayDate(base, targetWeekday, hour, minute, now) {
  const h = Number.isFinite(Number(hour)) ? Number(hour) : 11;
  const m = Number.isFinite(Number(minute)) ? Number(minute) : 0;
  let candidate = base.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  let daysAhead = (targetWeekday - base.weekday + 7) % 7;
  if (daysAhead === 0 && candidate <= now) daysAhead = 7; // if today but time passed → next week
  return candidate.plus({ days: daysAhead });
}

// =====================================
// Jordan day → UTC range helper
// =====================================
function getJordanDayUtcRange(localDayIso) {
  const zone = "Asia/Amman";
  const startJordan = DateTime.fromISO(localDayIso, { zone }).startOf("day");
  const endJordan = startJordan.endOf("day");
  return {
    start: startJordan.toUTC().toISO({ suppressMilliseconds: true }),
    end: endJordan.toUTC().toISO({ suppressMilliseconds: true }),
  };
}

// =====================================
// WhatsApp date formatter
// =====================================
function formatWhatsAppDate(dt, lang = "en", fmt = "ccc d LLL HH:mm") {
  if (!dt) return "";
  let dateObj = typeof dt === "string" ? DateTime.fromISO(dt) : dt;
  if (!dateObj.isValid) return "";
  let s = dateObj.setLocale(lang).toFormat(fmt);
  return lang === "ar" ? toArabicDigits(s) : s;
}

// =====================================
// Main parser entry point
// =====================================
function parseJordanDateTime(
  userText,
  existingISO = null,
  lang = "en",
  skipArabicExtract = false
) {
  const jordanZone = "Asia/Amman";
  const now = DateTime.now().setZone(jordanZone);
  const existingDt = existingISO
    ? DateTime.fromISO(existingISO, { zone: jordanZone })
    : null;

  try {
    console.log("[DT_PARSE] raw:", { userText, lang, existingISO });
  } catch {}

  // Arabic path: first try strict Arabic parsing + recognizer
  if (lang === "ar" || /[\u0600-\u06FF]/.test(userText)) {
    const refDate = (existingDt || now).toJSDate();

    // strict (no recursion)
    const isoStrict = extractArabicDate(userText, refDate, true);
    if (isoStrict) {
      const out = DateTime.fromISO(isoStrict, { zone: jordanZone }).toISO();
      try { console.log("[DT_PARSE] ar-strict ->", out); } catch {}
      return out;
    }

    // recognizer (unless skipping)
    if (!skipArabicExtract) {
      const iso = extractArabicDate(userText, refDate);
      if (iso) {
        const out = DateTime.fromISO(iso, { zone: jordanZone }).toISO();
        try { console.log("[DT_PARSE] ar-recognizer ->", out); } catch {}
        return out;
      }
    }

    // normalize Arabic→English tokens for fallback
    userText = normalizeArabicTime(userText);
  }

  // Normalize English-ish strings
  let cleaned = String(userText || "")
  .trim()
  .replace(/(\d)(am|pm)\b/gi, "$1 $2")                // 11pm -> 11 pm
  .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")      // 22nd -> 22
  .replace(/\b(of|at|to|for|on|this|coming|the)\b/gi, " ")
  .replace(
    /\b(change(?:\s+it)?(?:\s+to)?|move(?:\s+it)?(?:\s+to)?|set(?:\s+it)?(?:\s+to)?|reschedule|update|modify)\b/gi,
    " "
  )
  .replace(/\s+/g, " ")
  .toLowerCase();

  // Normalize common weekday misspellings before anchoring/parsing
  cleaned = cleaned
    .replace(/wedenesday|wedensday|wednesay|wendesday|wendsday|wednsday/gi, "wednesday")
    .replace(/staurday|saterday/gi, "saturday")
    .replace(/thrusday|thurday/gi, "thursday")
    .replace(/tusday|tuesdy/gi, "tuesday")
    .replace(/moday/gi, "monday")
    .replace(/firday/gi, "friday");

// Anchor to the first meaningful date token (today/tomorrow/weekday) to avoid stripping it
const anchor = cleaned.match(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
if (anchor) {
  const idx = cleaned.indexOf(anchor[0]);
  if (idx > 0) cleaned = cleaned.slice(idx).trim();
}

// (optional) pre-strip leading filler words that aren’t dates
cleaned = cleaned.replace(
  /^(?!\d)(?!today|tomorrow)(?!sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z\s]+/i,
  ""
).trim();


  try {
    console.log("[DT_PARSE] cleaned:", cleaned);
  } catch {}

  // Relative-day parsing: today/tomorrow with optional time (preserve existing time when absent)
  const relRe = /\b(today|tomorrow)\b(?:\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i;
  const relMatch = cleaned.match(relRe);
  if (relMatch) {
    const which = relMatch[1].toLowerCase();
    let base = which === "tomorrow" ? now.plus({ days: 1 }) : now;
    let hour = existingDt ? existingDt.hour : 11;
    let minute = existingDt ? existingDt.minute : 0;
    if (relMatch[2]) {
      hour = parseInt(relMatch[2], 10);
      minute = relMatch[3] ? parseInt(relMatch[3], 10) : 0;
      const ap = (relMatch[4] || "").toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
    }
    const out = base.set({ hour, minute, second: 0, millisecond: 0 }).toISO();
    try { console.log("[DT_PARSE] relative-day ->", out, { which, hour, minute }); } catch {}
    return out;
  }

  // A) time-only updates like "11" or "11 am"
  const timeOnlyMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeOnlyMatch) {
    let hour = parseInt(timeOnlyMatch[1], 10);
    const minute = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2], 10) : 0;
    const ap = (timeOnlyMatch[3] || "").toLowerCase();

    let baseDate = existingDt || now;
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;

    let finalDt = baseDate.set({ hour, minute, second: 0, millisecond: 0 });
    if (!existingDt && finalDt < now) {
      finalDt = finalDt.plus({ days: 1 }); // today in past → tomorrow
    }
    const out = finalDt.toISO();
    try { console.log("[DT_PARSE] time-only ->", out); } catch {}
    return out;
  }

  // B) month-word parsing (e.g., "2 sep 11 am", "2nd of september")
  const monthWordISO = tryMonthWordParse(cleaned, existingDt || now, now, jordanZone);
  if (monthWordISO) return monthWordISO;

  // C) Weekday (+ optional time) e.g., "wednesday", "wed 11 am"
  const wdNames =
    "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
    const wdTimeRe = new RegExp(
      `\\b(?:next\\s+|this\\s+|coming\\s+)?${wdNames}\\b(?:\\s+at)?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?`,
      "i"
    );
    const wdOnlyRe = new RegExp(
      `\\b(?:next\\s+|this\\s+|coming\\s+)?${wdNames}\\b`,
      "i"
    );

  const weekdayToNum = {
    sunday: 7,
    sun: 7,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  let m = cleaned.match(wdTimeRe);
  if (m) {
    const wdRaw = m[0].match(new RegExp(wdNames, "i"))?.[0] || "";
    const wdKey = wdRaw.toLowerCase();
    const targetWeekday =
      weekdayToNum[wdKey] ?? weekdayToNum[wdKey.slice(0, 3)];

    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;

    const finalDt = nextWeekdayDate(existingDt || now, targetWeekday, hour, minute, now);
    const out = finalDt.toISO();
    try { console.log("[DT_PARSE] weekday+time ->", out); } catch {}
    return out;
  }

  m = cleaned.match(wdOnlyRe);
  if (m) {
    const wdRaw = m[0].match(new RegExp(wdNames, "i"))?.[0] || "";
    const wdKey = wdRaw.toLowerCase();
    const targetWeekday =
      weekdayToNum[wdKey] ?? weekdayToNum[wdKey.slice(0, 3)];

    const hour = existingDt ? existingDt.hour : 11;
    const minute = existingDt ? existingDt.minute : 0;

    const finalDt = nextWeekdayDate(existingDt || now, targetWeekday, hour, minute, now);
    const out = finalDt.toISO();
    try { console.log("[DT_PARSE] weekday-only ->", out); } catch {}
    return out;
  }

  // D) Luxon formats (fallback). If no explicit year, Luxon uses current year.
  const hasYear = /\b\d{4}\b/.test(cleaned);
  const formats = [
    "d MMMM yyyy h:mm a", "d MMM yyyy h:mm a", "d/M/yyyy h:mm a",
    "d MMMM yyyy h a",   "d MMM yyyy h a",   "d/M/yyyy h a",
    "d MMMM h:mm a",     "d MMM h:mm a",     "d/M h:mm a",
    "d MMMM h a",        "d MMM h a",        "d/M h a",
    "cccc h:mm a",       "cccc h a",
    "d MMMM yyyy",       "d MMM yyyy",       "d/M/yyyy",
    "d MMMM",            "d MMM",            "d/M",
  ];

  for (const format of formats) {
    let dt = DateTime.fromFormat(cleaned, format, { zone: jordanZone });
    if (!dt.isValid) continue;

    let finalDt = dt;

    // If format didn't include 'y' and user didn't provide a year,
    // keep current year but avoid past dates by bumping to next year.
    if (!hasYear && !format.includes("y")) {
      finalDt = finalDt.set({ year: now.year });
      if (finalDt <= now) {
        finalDt = finalDt.plus({ years: 1 });
      }
    }

    // If no time component in the input, preserve existing time if present
    const hasTimeComponent = /[ap]m|\d:\d{2}/.test(cleaned);
    if (!hasTimeComponent && existingDt) {
      finalDt = finalDt.set({
        hour: existingDt.hour,
        minute: existingDt.minute,
        second: 0,
        millisecond: 0,
      });
    }

    const out = finalDt.toISO();
    try { console.log("[DT_PARSE] luxon-format ->", out, { format }); } catch {}
    return out;
  }

  try { console.log("[DT_PARSE] no match -> null"); } catch {}
  return null;
}

module.exports = {
  parseJordanDateTime,
  getJordanDayUtcRange,
  formatWhatsAppDate,
  toArabicDigits,
  extractArabicDate,
  cleanArabicForDate,
};

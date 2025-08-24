const { DateTime } = require("luxon");
const { recognizeDateTime } = require("@microsoft/recognizers-text-suite");

// Arabic day/month/relative mappings (still useful for fallback!)
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
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

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

function arabicIndicToEnglish(str) {
  return str.replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}
function toArabicDigits(str) {
  return str.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}
function replaceArabicAmPm(text) {
  // strip tatweel + harakat
  text = text.replace(/\u0640/gu, "");
  text = text.replace(/[\u064B-\u0652]/gu, "");

  // --- PM tokens ---
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

  // --- AM tokens ---
  text = text.replace(
    /(^|[\s:،,.\-])(الصبح|صبح)(?=$|[\s:،,.\-]|$)/gu,
    "$1 am "
  );
  text = text.replace(/(^|[\s:،,.\-])صباح(?:ا)?(?=$|[\s:،,.\-]|$)/gu, "$1 am ");
  text = text.replace(
    /(^|[\s:،,.\-])(الفجر|فجر)(?=$|[\s:،,.\-]|$)/gu,
    "$1 am "
  );

  // --- remove ساعة variants (both ة and ه) ---
  text = text.replace(
    /(^|[\s:،,.\-])(الساعة|ساعة|ساعه)(?=$|[\s:،,.\-]|$)/gu,
    " "
  );

  return text;
}

// Fallback normalization for custom logic if Recognizers fails
function normalizeArabicTime(text) {
  text = arabicIndicToEnglish(text);

  // turn final ه → ة using unicode-safe boundary
  text = text.replace(/ه(?=$|[\s:،,.\-])/gu, "ة");

  // days/relative/month mapping
  text = text.replace(
    /ال(جمعة|جمعه|سبت|احد|أحد|اثنين|إثنين|ثلاثاء|اربعاء|أربعاء|خميس)/gu,
    "$1"
  );
  for (const [ar, en] of Object.entries(AR_REL))
    text = text.replace(new RegExp(ar, "giu"), en);
  for (const [ar, en] of Object.entries(AR_DAY))
    text = text.replace(new RegExp(ar, "giu"), en);
  for (const [ar, en] of Object.entries(AR_MONTH))
    text = text.replace(new RegExp(ar, "giu"), en);
  text = text.replace(
    /ال(friday|saturday|sunday|monday|tuesday|wednesday|thursday)/gi,
    "$1"
  );

  // drop filler words (unicode-safe)
  text = text.replace(/\b(?:على|عال|ال)\b\s*/giu, " ");

  // map Arabic AM/PM + remove ساعة
  const before = text;
  text = replaceArabicAmPm(text);
  // console.log("AMPAM MAP:", before, "→", text);

  // if any Arabic words still remain, drop them (we already mapped days/months)
  text = text.replace(/[\u0600-\u06FF]+/gu, " ");

  // normalize "h[:mm] am|pm"
  text = text.replace(
    /(\d{1,2})(?:\s*[:٫،]\s*(\d{2}))?\s*(am|pm)/gi,
    (_m, h, min, ap) => `${h}${min ? ":" + min : ""} ${ap}`
  );

  text = text.replace(/\s+/g, " ").trim();
  console.log("NORMALIZED STRING SENT TO LUXON:", text);
  return text;
}

function cleanArabicForDate(text) {
  return (
    text
      // Remove common intent/filler words
      .replace(
        /(?:بدي|أ?عدل|تعديل|حاب|حابب|ابغى|التاريخ|تاريخ|ليوم|يوم|الوقت|الساعة|ساعة|إلى|الى|على|عال|ال)/g,
        ""
      )
      // Remove extra spaces
      .replace(/\b(?:اه|آه|ايوه|طيب)\b/gi, "")
      .replace(/\bل\s+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// === MICROSOFT RECOGNIZER FOR ARABIC DATES ===
function extractArabicDate(text, refDate = new Date(), noRecurse = false) {
  const zone = "Asia/Amman";
  const now = DateTime.fromJSDate(refDate).setZone(zone);

  // 1) Normalize digits and am/pm words
  let src = arabicIndicToEnglish(text);
  let forTime = replaceArabicAmPm(src);

  // 2) Try explicit D/M(/Y) first (Jordan style)
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

  // Find the date position, so we can prefer times after it
  const dmyRe = /(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/g;
  let dmyExec = dmyRe.exec(forTime);
  const afterIdx = dmyExec ? dmyExec.index + dmyExec[0].length : 0;

  // Time regex
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
    } else {
      if (!best)
        best = { ...candidate, after: false, afterHasAp: candidate.hasAp };
    }
  }
  if (best) {
    hour = best.h;
    minute = best.min;
    ap = best.apTok;
  }

  // If we found a D/M date, build the DateTime now.
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

  // 4) No numeric D/M found — skip recursive fallback if noRecurse flag is set
  if (!noRecurse) {
    // (If you still want a fallback, uncomment the below)
    // const isoFromFallback = parseJordanDateTime(text, null, "ar");
    // if (isoFromFallback) return isoFromFallback;
  }

  // 5) Microsoft Recognizers
  try {
    const res = recognizeDateTime(text, "ar-sa", refDate) || [];
    if (res.length) {
      const v = res[0].resolution?.values?.[0];
      if (v?.value) {
        // If recognizer returned date-only, append time if we captured one above
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

  return null;
}

// === MAIN ENTRYPOINT FOR ANY WHATSAPP DATE PARSING ===
function parseJordanDateTime(
  userText,
  existingISO = null,
  lang = "en",
  skipArabicExtract = false
) {
  const jordanZone = "Asia/Amman";
  let dt;

  if (lang === "ar" || /[\u0600-\u06FF]/.test(userText)) {
    const iso = extractArabicDate(userText, new Date(), true); // <-- pass true here!
    if (iso) {
      return DateTime.fromISO(iso, { zone: jordanZone }).toISO();
    }
  }
  // ---- FIRST TRY: Microsoft Recognizer for Arabic
  if (
    (!skipArabicExtract && lang === "ar") ||
    /[\u0600-\u06FF]/.test(userText)
  ) {
    const iso = extractArabicDate(userText);
    if (iso) {
      return DateTime.fromISO(iso, { zone: jordanZone }).toISO();
    }
    // Otherwise fallback to custom logic below
  }

  // ---- FALLBACK: Your previous normalization + Luxon logic
  let cleaned = userText.trim();
  if (lang === "ar" || /[\u0600-\u06FF]/.test(cleaned)) {
    cleaned = normalizeArabicTime(cleaned);
  }

  console.log("DEBUG Normalized:", cleaned);
  cleaned = cleaned
    .replace(/(\d)(am|pm)\b/gi, "$1 $2") // 11pm -> 11 pm
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1")
    .replace(/\b(of|at|to)\b/gi, " ")
    .replace(
      /\b(change(?:\s+it)?(?:\s+to)?|move(?:\s+it)?(?:\s+to)?|set(?:\s+it)?(?:\s+to)?|reschedule|update|modify)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  console.log("DEBUG cleaned after rules:", cleaned);

  const hasClock =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.test(cleaned) || // 7 pm, 7:15 pm
    /\b\d{1,2}:\d{2}\b/.test(cleaned); // 19:00

  // Extract first date-like sequence

  const dateLikePattern = new RegExp(
    "\\b(?:" +
      "tomorrow|today|day\\s+after\\s+tomorrow|" +
      "sunday|monday|tuesday|wednesday|thursday|friday|saturday|" +
      "\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+" +
      MONTH_RE +
      "(?:\\s+\\d{4})?|" + // 22 (of) aug
      MONTH_RE +
      "\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+\\d{4})?|" + // aug 22
      "\\d{1,2}[\\/-]\\d{1,2}(?:[\\/-]\\d{2,4})?|" +
      "\\d{4}-\\d{2}-\\d{2}" +
      ")" +
      "(?:\\s*\\d{1,2})?(?::\\d{2})?\\s*(?:am|pm)?",
    "i"
  );

  const dateMatch = cleaned.match(dateLikePattern);
  if (dateMatch) cleaned = dateMatch[0].trim();
  cleaned = cleaned
    .replace(/\b(please|kindly|at|on|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // --- Custom Luxon parsing fallback (your old logic, untouched) ---
  if (/day after tomorrow/.test(cleaned)) {
    let match = cleaned.match(
      /day after tomorrow(?:\s*at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
    );
    const base = DateTime.now().setZone(jordanZone).plus({ days: 2 });
    if (match) {
      let hour = parseInt(match[1]);
      let minute = match[2] ? parseInt(match[2]) : 0;
      let ampm = match[3] || "";
      let final = base.set({ hour, minute, second: 0, millisecond: 0 });
      if (ampm === "pm" && hour < 12) final = final.set({ hour: hour + 12 });
      if (ampm === "am" && hour === 12) final = final.set({ hour: 0 });
      return final.toISO();
    }
    return base.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toISO();
  }
  if (/tomorrow/.test(cleaned)) {
    let match = cleaned.match(
      /tomorrow(?:\s*at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
    );
    const base = DateTime.now().setZone(jordanZone).plus({ days: 1 });
    if (match) {
      let hour = parseInt(match[1]);
      let minute = match[2] ? parseInt(match[2]) : 0;
      let ampm = match[3] || "";
      let final = base.set({ hour, minute, second: 0, millisecond: 0 });
      if (ampm === "pm" && hour < 12) final = final.set({ hour: hour + 12 });
      if (ampm === "am" && hour === 12) final = final.set({ hour: 0 });
      return final.toISO();
    }
    return base.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toISO();
  }
  if (/today/.test(cleaned)) {
    let match = cleaned.match(
      /today(?:\s*at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
    );
    const base = DateTime.now().setZone(jordanZone);
    if (match) {
      let hour = parseInt(match[1]);
      let minute = match[2] ? parseInt(match[2]) : 0;
      let ampm = match[3] || "";
      let final = base.set({ hour, minute, second: 0, millisecond: 0 });
      if (ampm === "pm" && hour < 12) final = final.set({ hour: hour + 12 });
      if (ampm === "am" && hour === 12) final = final.set({ hour: 0 });
      return final.toISO();
    }
    return base.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toISO();
  }
  // Weekday pattern
  const weekdayMap = {
    sunday: 7,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const weekdayPattern =
    /\b(?:next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b[\s,]*([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?/;
  const matchWday = cleaned.match(weekdayPattern);
  if (matchWday) {
    const [, weekday, hourStr, minStr, ampm] = matchWday;
    const now = DateTime.now().setZone(jordanZone);
    let targetDay = weekdayMap[weekday];
    let base = now.startOf("day");
    let currentWeekday = now.weekday;
    let addDays = (targetDay - currentWeekday + 7) % 7;
    if (addDays === 0) addDays = 7;
    let date = base.plus({ days: addDays });
    let hour = hourStr ? parseInt(hourStr) : 12;
    let minute = minStr ? parseInt(minStr) : 0;
    let h = hour;
    if (ampm === "pm" && hour < 12) h = hour + 12;
    if (ampm === "am" && hour === 12) h = 0;
    date = date.set({ hour: h, minute, second: 0, millisecond: 0 });
    return date.toISO();
  }

  const wdOnly = cleaned.match(
    /^(?:next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i
  );
  if (wdOnly) {
    const weekday = wdOnly[1].toLowerCase();
    const now = DateTime.now().setZone(jordanZone);
    const weekdayMap = {
      sunday: 7,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    let targetDay = weekdayMap[weekday];
    let base = now.startOf("day");
    let addDays = (targetDay - now.weekday + 7) % 7;
    if (addDays === 0) addDays = 7;

    let hour = 12,
      minute = 0;
    if (existingISO) {
      const ex = DateTime.fromISO(existingISO, { zone: jordanZone });
      if (ex.isValid) {
        hour = ex.hour;
        minute = ex.minute;
      }
    }
    const date = base
      .plus({ days: addDays })
      .set({ hour, minute, second: 0, millisecond: 0 });
    return date.toISO();
  }
  // Fallback for time only
  let timeOnlyMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeOnlyMatch) {
    let hour = parseInt(timeOnlyMatch[1]);
    let minute = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2]) : 0;
    let ampm = timeOnlyMatch[3] || "";
    let now = DateTime.now().setZone(jordanZone);
    let date = now.set({ hour, minute, second: 0, millisecond: 0 });
    if (ampm === "pm" && hour < 12) date = date.set({ hour: hour + 12 });
    if (ampm === "am" && hour === 12) date = date.set({ hour: 0 });
    if (date < now) date = date.plus({ days: 1 });
    return date.toISO();
  }
  // Try normal date formats
  const currentYear = DateTime.now().setZone(jordanZone).year;
  const formats = [
    "d LLLL yyyy h a",
    "d LLLL yyyy h:mm a",
    "d LLLL h a",
    "d LLLL h:mm a",
    "d M yyyy h a",
    "d M yyyy h:mm a",
    "d M h a",
    "d M h:mm a",
    "d M yyyy HH:mm",
    "d M HH:mm",
    "cccc d LLLL yyyy h a",
    "cccc d LLLL h a",
    "cccc d LLLL h:mm a",
    "yyyy-MM-dd HH:mm",
    "yyyy-MM-dd h:mm a",
    "yyyy-MM-dd h a",
    "yyyy-MM-dd",
    "d/M/yyyy h a",
    "d/M/yyyy h:mm a",
    "d/M/yyyy",
    "d/M h a",
    "d/M h:mm a",
    "d LLLL", // e.g., 22 august
    "d LLL",
    "d LLL h a",
    "d LLL h:mm a",
  ];
  for (const format of formats) {
    if (!existingISO) {
      const m = cleaned.match(
        /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)(?:\s+(\d{4}))?$/i
      );
      if (m) {
        const day = parseInt(m[1], 10);
        let rawMonth = m[2].toLowerCase();
        const year = m[3] ? parseInt(m[3], 10) : currentYear;

        let key = rawMonth;
        if (!EN_MONTH[key] && key.length > 3) key = key.slice(0, 3);
        const monthNum = EN_MONTH[key];
        if (monthNum) {
          const base = DateTime.fromObject(
            {
              year,
              month: monthNum,
              day,
              hour: 12,
              minute: 0,
              second: 0,
              millisecond: 0,
            },
            { zone: jordanZone }
          );
          return base.toISO();
        }
      }
    }

    dt = DateTime.fromFormat(cleaned, format, {
      zone: jordanZone,
      locale: "en",
    });

    if (dt.isValid) {
      if (!format.includes("yyyy") && !format.includes("y")) {
        dt = dt.set({ year: currentYear });
      }

      // ⬇️ NEW: if user didn’t type a clock, don’t return midnight
      if (!hasClock) {
        if (existingISO) {
          const ex = DateTime.fromISO(existingISO, { zone: jordanZone });
          if (ex.isValid) {
            dt = dt.set({
              hour: ex.hour,
              minute: ex.minute,
              second: 0,
              millisecond: 0,
            });
          }
        } else {
          dt = dt.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
        }
      }

      return dt.toISO();
    }
  }
  dt = DateTime.fromISO(cleaned, { zone: jordanZone });
  if (dt.isValid) {
    // ⬇️ NEW: if no clock in text, keep old time or default to 12:00
    if (!hasClock) {
      if (existingISO) {
        const ex = DateTime.fromISO(existingISO, { zone: jordanZone });
        if (ex.isValid) {
          dt = dt.set({
            hour: ex.hour,
            minute: ex.minute,
            second: 0,
            millisecond: 0,
          });
        }
      } else {
        dt = dt.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
      }
    }
    return dt.toISO();
  }
  // Time only with existing date context
  if (existingISO) {
    const existingDt = DateTime.fromISO(existingISO, { zone: jordanZone });
    let timeMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const ampm = timeMatch[3] || "";
      let base = existingDt.set({ hour, minute, second: 0, millisecond: 0 });
      if (ampm === "pm" && hour < 12) base = base.set({ hour: hour + 12 });
      if (ampm === "am" && hour === 12) base = base.set({ hour: 0 });
      return base.toISO();
    }
    let dateMatch = cleaned.match(
      /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(\w+)(?:\s+(\d{4}))?$/i
    );
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const rawMonth = dateMatch[2].toLowerCase();
      const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : currentYear;

      let key = rawMonth;
      if (!EN_MONTH[key] && key.length > 3) key = key.slice(0, 3);
      const monthNum = EN_MONTH[key];
      if (monthNum) {
        const existingDt = DateTime.fromISO(existingISO, { zone: jordanZone });
        const base = existingDt.set({ year, month: monthNum, day });
        return base.toISO();
      }
    }
  }
  return null;
}

function getJordanDayUtcRange(localDayIso) {
  const zone = "Asia/Amman";
  const startJordan = DateTime.fromISO(localDayIso, { zone }).startOf("day");
  const endJordan = startJordan.endOf("day");
  const startUtc = startJordan.toUTC();
  const endUtc = endJordan.toUTC();
  return {
    start: startUtc.toISO({ suppressMilliseconds: true }),
    end: endUtc.toISO({ suppressMilliseconds: true }),
  };
}

function formatWhatsAppDate(dt, lang = "en", fmt = "ccc d LLL HH:mm") {
  if (!dt) return "";
  let dateObj = typeof dt === "string" ? DateTime.fromISO(dt) : dt;
  if (!dateObj.isValid) return "";
  let s = dateObj.setLocale(lang).toFormat(fmt);
  if (lang === "ar") return toArabicDigits(s);
  return s;
}

module.exports = {
  parseJordanDateTime,
  getJordanDayUtcRange,
  formatWhatsAppDate,
  toArabicDigits,
  extractArabicDate,
  cleanArabicForDate,
};

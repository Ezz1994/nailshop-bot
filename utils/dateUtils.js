// utils/dateUtils.js

const chrono = require("chrono-node");
const { DateTime } = require("luxon");

const TIME_ZONE = "Asia/Amman";

// Bump a DateTime into the future if it lands in the past (yearly)
function bumpIntoFuture(dt) {
  const now = DateTime.now().setZone(TIME_ZONE);
  while (dt < now) dt = dt.plus({ years: 1 });
  return dt;
}

// Rewrite "tomorrow / Monday / next week Monday" to explicit date (YYYY-MM-DD)
function replaceRelativeDates(raw) {
  const base = DateTime.now().setZone(TIME_ZONE).startOf("day");
  const WEEKDAYS = {
    sunday: 7,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const iso = (d) => base.plus({ days: d }).toISODate();

  const nextWeekDate = (dow) => {
    let delta = WEEKDAYS[dow] - base.weekday;
    if (delta <= 0) delta += 7;
    delta += 7; // jump to next week
    return iso(delta);
  };
  const nextOccurrence = (dow) => {
    let delta = WEEKDAYS[dow] - base.weekday;
    if (delta <= 0) delta += 7;
    return iso(delta);
  };

  return raw
    .replace(/\b(day after tomorrow|after tomorrow)\b/gi, () => iso(2))
    .replace(/\b(next day|tomorrow)\b/gi, () => iso(1))
    .replace(/\btoday\b/gi, () => iso(0))
    .replace(
      /\bnext\s+week\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
      (_, d) => nextWeekDate(d.toLowerCase())
    )
    .replace(
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
      (d) => nextOccurrence(d.toLowerCase())
    );
}

// Fix awkward wording for date + time
function cleanChronoInput(input) {
  let cleaned = input.replace(/\band\s+at\b/gi, "at");
  cleaned = cleaned.replace(/\band\s*@\b/gi, "at");
  cleaned = cleaned.replace(
    /(\d{1,2}\s+\w+\s+)and\s+(\d{1,2}(:\d{2})?\s*(am|pm)?)/gi,
    "$1at $2"
  );
  cleaned = cleaned.replace(
    /(\d{1,2}\s+\w+)\s+and\s+(\d{1,2}(:\d{2})?\s*(am|pm))/gi,
    "$1 at $2"
  );
  return cleaned;
}

// Parse a date string to ISO
function parseDate(input) {
  const base = DateTime.now().setZone(TIME_ZONE);

  let cleaned = input.trim().replace(/\bat\b/gi, " ").replace(/\s+/g, " ");
  cleaned = replaceRelativeDates(cleaned);

  // Use chrono-node for robust parsing
  const cleanedInput = cleanChronoInput(input);
  const c = chrono.parse(cleanedInput, base.toJSDate(), { forwardDate: true });
  if (c.length && c[0].start) {
    let dt = DateTime.fromJSDate(c[0].start.date()).setZone(TIME_ZONE);
    dt = bumpIntoFuture(dt);
    const iso = dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
    return iso;
  }

  // Try strict fallback formats
  const formats = [
    "yyyy-MM-dd h:mm a",
    "yyyy-MM-dd H:mm",
    "yyyy-MM-dd hh:mm a",
    "yyyy-MM-dd HH:mm",
    "yyyy-MM-dd",
    "yyyy/MM/dd h:mm a",
    "yyyy/MM/dd H:mm",
    "yyyy/MM/dd",
  ];
  for (const f of formats) {
    let dt = DateTime.fromFormat(cleaned, f, { zone: TIME_ZONE });
    if (dt.isValid) {
      dt = bumpIntoFuture(dt);
      const iso = dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
      return iso;
    }
  }

  return null;
}

// Does the text have time info?
function containsTimeInfo(text) {
  const timePatterns = [
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\s*(am|pm)\b/i,
    /\b(morning|afternoon|evening|night)\b/i,
    /\b(noon|midnight)\b/i,
  ];
  return timePatterns.some((pattern) => pattern.test(text));
}

// Does the text have date info?
function containsDateInfo(text) {
  const datePatterns = [
    /\b(tomorrow|today|yesterday)\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b\d{1,2}(st|nd|rd|th)\s+(of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,
    /\bnext\s+week\b/i,
  ];
  return datePatterns.some((pattern) => pattern.test(text));
}

// Parse a new date/time while preserving any missing part from existing
function parseDatePreservingTime(input, existingDateTime = null) {
  const hasTime = containsTimeInfo(input);
  const hasDate = containsDateInfo(input);

  if (existingDateTime) {
    const existingDT = DateTime.fromISO(existingDateTime).setZone(TIME_ZONE);

    // Both date and time in input? Use chrono-node directly.
    if (hasDate && hasTime) {
      const base = DateTime.now().setZone(TIME_ZONE);
      const cleanedInput = cleanChronoInput(input);
      const c = chrono.parse(cleanedInput, base.toJSDate(), { forwardDate: true });
      if (c.length && c[0].start) {
        let dt = DateTime.fromJSDate(c[0].start.date()).setZone(TIME_ZONE);
        dt = bumpIntoFuture(dt);
        const iso = dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
        return iso;
      }
      // fallback
      const newISO = parseDate(cleanedInput);
      if (newISO) return newISO;
    }

    // Date only (no time): keep old time
    if (hasDate && !hasTime) {
      const newISO = parseDate(input);
      if (newISO) {
        const newDT = DateTime.fromISO(newISO).setZone(TIME_ZONE);
        const combinedDT = newDT.set({
          hour: existingDT.hour,
          minute: existingDT.minute,
        });
        const result = combinedDT.toFormat("yyyy-MM-dd'T'HH:mm:ss");
        return result;
      }
    }

    // Time only (no date): keep old date
    if (hasTime && !hasDate) {
      // Try to extract time from chrono
      const chronoRes = chrono.parse(input, existingDT.toJSDate(), {
        forwardDate: true,
      });
      if (chronoRes.length && chronoRes[0].start) {
        const newTime = chronoRes[0].start;
        const combinedDT = existingDT.set({
          hour: newTime.get("hour") ?? existingDT.hour,
          minute: newTime.get("minute") ?? 0,
        });
        const result = combinedDT.toFormat("yyyy-MM-dd'T'HH:mm:ss");
        return result;
      } else {
        // fallback: crude regex
        const timeMatch = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1], 10);
          let minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
          let ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
          if (ampm === "pm" && hour < 12) hour += 12;
          if (ampm === "am" && hour === 12) hour = 0;
          const combinedDT = existingDT.set({ hour, minute });
          const result = combinedDT.toFormat("yyyy-MM-dd'T'HH:mm:ss");
          return result;
        }
      }
    }
  }

  // No special preservation, just parse
  return parseDate(input);
}

module.exports = {
  bumpIntoFuture,
  replaceRelativeDates,
  cleanChronoInput,
  parseDate,
  containsTimeInfo,
  containsDateInfo,
  parseDatePreservingTime,
};

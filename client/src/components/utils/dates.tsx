// src/utils/dates.ts
import { DateTime } from "luxon";

/**
 * Checks if a booking's start_at datetime is on the given day (in Asia/Amman timezone).
 * @param bookingStartAt ISO datetime string (e.g. "2025-07-15T00:41:00.000Z")
 * @param jsDate         JS Date object (e.g. for July 14, 2025 local)
 * @param tz             IANA timezone string (default: Asia/Amman)
 */


export function isBookingOnDay(
  startAtUtc: string | Date,
  dayDate: Date,
  zone = "Asia/Amman"
) {
  // Booking instant -> local Jordan date
  const bookingDT =
    typeof startAtUtc === "string"
      ? DateTime.fromISO(startAtUtc, { zone: "utc" }).setZone(zone)
      : DateTime.fromJSDate(startAtUtc, { zone: "utc" }).setZone(zone);

  if (!bookingDT.isValid) return false;
  const bookingDay = bookingDT.toISODate();

  // IMPORTANT: construct the target day from Y/M/D in the *Jordan* zone
  const targetDay = DateTime.fromObject(
    {
      year: dayDate.getFullYear(),
      month: dayDate.getMonth() + 1,
      day: dayDate.getDate(),
    },
    { zone }
  ).toISODate();

  return bookingDay === targetDay;
}

export const toJordanYMD = (d: Date, zone = "Asia/Amman") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
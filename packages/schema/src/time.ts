import type { ISODateTime } from "./types";

export function zonedLocalToIso(date: string, time: string, timeZone: string): ISODateTime | null {
  if (!time) return null;
  if (!isDate(date) || !isTime(time)) return null;

  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredAsUtc;

  // Two passes handle most DST transitions because the first pass discovers
  // the offset and the second confirms it at the corrected instant.
  for (let pass = 0; pass < 2; pass += 1) {
    const represented = partsInTimeZone(new Date(guess), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    guess += desiredAsUtc - representedAsUtc;
  }

  const finalParts = partsInTimeZone(new Date(guess), timeZone);
  if (
    finalParts.year !== year ||
    finalParts.month !== month ||
    finalParts.day !== day ||
    finalParts.hour !== hour ||
    finalParts.minute !== minute
  ) {
    return null;
  }
  return new Date(guess).toISOString();
}

export function timeInZone(value: ISODateTime | null, timeZone: string): string {
  if (!value) return "";
  const parts = partsInTimeZone(new Date(value), timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dateInZone(value: ISODateTime, timeZone: string): string {
  const parts = partsInTimeZone(new Date(value), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function partsInTimeZone(
  value: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } {
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    dayOfWeek: weekdayMap[read("weekday")] ?? 0,
  };
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
